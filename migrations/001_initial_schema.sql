-- AstroVital Initial Relational Schema Migration (v1.0)
-- Compatible with SQLite 3.x and PostgreSQL 15+

-- Core Identity & RBAC: roles, permissions, role_permissions, users, user_sessions, astronaut_profiles
-- Mission & Context Engine: environment_profiles, missions, mission_assignments, mission_phases, mission_contexts
-- Health & Rules Engine: data_sources, sensor_registry, health_indicator_definitions, health_baselines,
--   clinical_rules, clinical_rule_versions, health_measurements, environmental_measurements, data_quality_events
-- Alerts & Preventive Follow-Up: alerts, alert_acknowledgements, follow_up_actions
-- Psychological Wellness: wellness_instruments, psychological_wellness_assessments, wellness_recommendations, wellness_action_feedbacks
-- Gamification: daily_missions, gamification_profiles, gamification_events, badges, user_badges
-- Governance & Exports: reports, audit_events

-- Managed automatically via SQLAlchemy ORM metadata in backend.app.models.models
-- Run `python scripts/init_demo_db.py` to initialize schema and seed DEMO data.

