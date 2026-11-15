import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.database.session import get_db
from backend.app.models.models import (
    AuditEvent,
    MissionAssignment,
    Permission,
    Role,
    RolePermission,
    User,
    UserSession,
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


FAMILY_ROLE_CODE = "FAMILY_MEMBER"

# Rutas (bajo /api/v1) que un FAMILY_MEMBER puede usar; todo lo demás devuelve 403.
_FAMILY_ALLOWED_EXACT = {"/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/conversations", "/api/v1/attachments"}
_FAMILY_ALLOWED_PREFIXES = (
    "/api/v1/conversations/",
    "/api/v1/messages/",
    "/api/v1/attachments/",
    "/api/v1/family/",
)


def is_family_path_allowed(path: str) -> bool:
    path = path.rstrip("/") or "/"
    if path in _FAMILY_ALLOWED_EXACT:
        return True
    return any(path.startswith(p) for p in _FAMILY_ALLOWED_PREFIXES)


def ensure_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def hash_password(password: str, salt: Optional[str] = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        120_000,
    )
    return f"pbkdf2_sha256$120000${salt}${dk.hex()}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    try:
        parts = stored_hash.split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        iterations = int(parts[1])
        salt = parts[2]
        expected_hex = parts[3]
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return hmac.compare_digest(dk.hex(), expected_hex)
    except Exception:
        return False


def log_audit_event(
    db: Session,
    action: str,
    resource_type: str,
    actor: Optional[User] = None,
    resource_id: Optional[str] = None,
    target_user_id: Optional[int] = None,
    justification: Optional[str] = None,
    status_code: str = "SUCCESS",
    details: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> AuditEvent:
    role_code = actor.role.code if (actor and actor.role) else None
    event = AuditEvent(
        actor_user_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        actor_role=role_code,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        target_user_id=target_user_id,
        justification=justification,
        ip_address=ip_address or "127.0.0.1",
        status=status_code,
        details=details,
        created_at=utcnow(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def get_current_session(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_session_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> UserSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_session_token:
        token = x_session_token.strip()
    elif "session_token" in request.query_params:
        token = request.query_params["session_token"].strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide a valid Bearer session token.",
        )

    session_obj = (
        db.query(UserSession)
        .filter(UserSession.token == token, UserSession.is_revoked.is_(False))
        .first()
    )
    if not session_obj:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked session token.",
        )

    if ensure_aware(session_obj.expires_at) < utcnow():
        session_obj.is_revoked = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    user = session_obj.user
    if not user or user.status != "ACTIVE":
        session_obj.is_revoked = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is suspended or inactive.",
        )

    # Rol FAMILY_MEMBER: denegación por defecto. Solo sesión, /auth/me, su canal FAMILY y adjuntos.
    if user.role and user.role.code == FAMILY_ROLE_CODE and not is_family_path_allowed(request.url.path):
        log_audit_event(
            db=db,
            action="FAMILY_MEMBER_ACCESS_DENIED",
            resource_type=request.url.path[:80],
            actor=user,
            status_code="DENIED",
            details="Un familiar autorizado intentó acceder a un módulo fuera del canal familiar.",
            ip_address=request.client.host if request.client else "127.0.0.1",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: los familiares solo pueden usar el canal Conexión con Tierra.",
        )

    return session_obj


def get_current_user(
    session_obj: UserSession = Depends(get_current_session),
) -> User:
    return session_obj.user


def get_user_permissions(db: Session, user: User) -> List[str]:
    if not user.role:
        return []
    rows = (
        db.query(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == user.role_id)
        .all()
    )
    return [r[0] for r in rows]


def require_roles(allowed_roles: List[str]):
    def dependency(
        request: Request,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        role_code = user.role.code if user.role else ""
        if role_code not in allowed_roles:
            log_audit_event(
                db=db,
                action="UNAUTHORIZED_ROLE_ACCESS",
                resource_type=request.url.path,
                actor=user,
                status_code="DENIED",
                details=f"Role '{role_code}' attempted access requiring {allowed_roles}",
                ip_address=request.client.host if request.client else "127.0.0.1",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role permissions for this operation.",
            )
        return user

    return dependency


def is_astronaut_assigned_to_leader(db: Session, leader_id: int, astronaut_id: int) -> bool:
    leader_mission_ids = [
        r[0]
        for r in db.query(MissionAssignment.mission_id)
        .filter(
            MissionAssignment.user_id == leader_id,
            MissionAssignment.is_active.is_(True),
        )
        .all()
    ]
    if not leader_mission_ids:
        return False

    shared = (
        db.query(MissionAssignment)
        .filter(
            MissionAssignment.mission_id.in_(leader_mission_ids),
            MissionAssignment.user_id == astronaut_id,
            MissionAssignment.is_active.is_(True),
        )
        .first()
    )
    return shared is not None


def get_authorized_astronaut_ids(db: Session, user: User) -> List[int]:
    role_code = user.role.code if user.role else ""
    if role_code == "ASTRONAUT":
        return [user.id]
    if role_code == "MISSION_LEADER":
        leader_missions = [
            r[0]
            for r in db.query(MissionAssignment.mission_id)
            .filter(
                MissionAssignment.user_id == user.id,
                MissionAssignment.is_active.is_(True),
            )
            .all()
        ]
        if not leader_missions:
            return []
        astronaut_rows = (
            db.query(MissionAssignment.user_id)
            .join(User, User.id == MissionAssignment.user_id)
            .join(Role, Role.id == User.role_id)
            .filter(
                MissionAssignment.mission_id.in_(leader_missions),
                MissionAssignment.is_active.is_(True),
                Role.code == "ASTRONAUT",
            )
            .distinct()
            .all()
        )
        return [r[0] for r in astronaut_rows]
    if role_code == "ADMINISTRATOR":
        astronaut_rows = (
            db.query(User.id)
            .join(Role, Role.id == User.role_id)
            .filter(Role.code == "ASTRONAUT")
            .all()
        )
        return [r[0] for r in astronaut_rows]
    return []


def verify_astronaut_access(
    db: Session,
    actor: User,
    target_astronaut_id: int,
    action_name: str = "READ_ASTRONAUT_DATA",
    audit_justification: Optional[str] = None,
    is_sensitive_psychological: bool = False,
) -> User:
    target_user = db.query(User).filter(User.id == target_astronaut_id).first()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Requested crew member not found.",
        )

    role_code = actor.role.code if actor.role else ""

    if role_code == "ASTRONAUT":
        if actor.id != target_astronaut_id:
            log_audit_event(
                db=db,
                action=action_name,
                resource_type="ASTRONAUT_DATA",
                actor=actor,
                resource_id=str(target_astronaut_id),
                target_user_id=target_astronaut_id,
                status_code="DENIED",
                details="Horizontal privilege escalation prevented: Astronaut attempted to view another astronaut's data.",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Astronauts can only access their own health and wellness records.",
            )
        return target_user

    if role_code == "MISSION_LEADER":
        if not is_astronaut_assigned_to_leader(db, actor.id, target_astronaut_id):
            log_audit_event(
                db=db,
                action=action_name,
                resource_type="ASTRONAUT_DATA",
                actor=actor,
                resource_id=str(target_astronaut_id),
                target_user_id=target_astronaut_id,
                status_code="DENIED",
                details="Mission Leader attempted to access an unassigned astronaut.",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You can only supervise astronauts assigned to your missions.",
            )
        if is_sensitive_psychological:
            log_audit_event(
                db=db,
                action=action_name,
                resource_type="PSYCHOLOGICAL_PRIVATE_DETAILS",
                actor=actor,
                resource_id=str(target_astronaut_id),
                target_user_id=target_astronaut_id,
                status_code="DENIED",
                details="Mission Leader blocked from raw private psychological reflection responses.",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Detailed psychological questionnaire answers are private by default.",
            )
        return target_user

    if role_code == "ADMINISTRATOR":
        if is_sensitive_psychological and not audit_justification:
            log_audit_event(
                db=db,
                action=action_name,
                resource_type="PSYCHOLOGICAL_PRIVATE_DETAILS",
                actor=actor,
                resource_id=str(target_astronaut_id),
                target_user_id=target_astronaut_id,
                status_code="DENIED",
                details="Administrator attempted to access sensitive psychological records without explicit audited justification.",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Administrative role does not grant automatic access to private psychological records without explicit justification and audit reason.",
            )
        if audit_justification:
            log_audit_event(
                db=db,
                action=action_name,
                resource_type="ASTRONAUT_SENSITIVE_DATA",
                actor=actor,
                resource_id=str(target_astronaut_id),
                target_user_id=target_astronaut_id,
                justification=audit_justification,
                status_code="SUCCESS",
                details=f"Audited administrative access with justification: {audit_justification}",
            )
        return target_user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied.",
    )

