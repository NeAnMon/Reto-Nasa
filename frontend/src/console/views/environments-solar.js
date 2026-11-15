/*
 * SEMSA · Consola de salud · Sistema Solar 3D interactivo (integración de repo-planets.vercel.app)
 *
 * Adapta los shaders GLSL procedurales de repo-planets (ruido Simplex 3D, FBM de 4 y 5 octavas,
 * nebulosa de fondo, campo estelar con centelleo, Sol con celdas de convección + corona Fresnel +
 * partículas de brasa solar, cintas orbitales con estela luminosa, planetas rocosos/gaseosos/helados/
 * craterizados con atmósfera Fresnel, nubes, anillos, lunas y cometas) sobre WebGL nativo sin
 * dependencias externas.
 *
 * Cuando se selecciona uno de los 5 entornos de SEMSA (spacecraft, station, rover, base, moon),
 * la cámara interpola suavemente su posición y objetivo hacia el cuerpo/entorno correspondiente y
 * lo sigue en su órbita.
 */

/* ───────────────────────── Shaders GLSL de repo-planets ───────────────────────── */

const NOISE_GLSL = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * snoise(p);
    p *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}

float fbm4(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * snoise(p);
    p *= 2.13;
    amplitude *= 0.5;
  }
  return value;
}
`;

// Nebulosa de fondo (X4 / j4 de repo-planets)
const NEBULA_VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NEBULA_FRAG = `
precision highp float;
${NOISE_GLSL}
uniform float uTime;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float n1 = fbm(dir * 2.2 + vec3(uTime * 0.004));
  float n2 = fbm(dir * 4.5 - uTime * 0.002 + n1 * 0.6);
  float n3 = fbm4(dir * 7.5 + vec3(n2 * 0.8, n1 * 0.5, uTime * 0.003));

  vec3 bandNormal = normalize(vec3(0.35, 0.85, 0.25));
  float bd = dot(dir, bandNormal);
  float band = exp(-bd * bd * 14.0);
  band *= 0.55 + 0.45 * smoothstep(-0.4, 0.6, n2);

  float d1 = smoothstep(0.12, 0.78, n1 + band * 0.35);
  float d2 = smoothstep(0.22, 0.85, n2 + band * 0.2);
  float crossBands = d1 * d2;

  vec3 base = vec3(0.0118, 0.0, 0.0784);
  vec3 violet = vec3(0.180, 0.063, 0.396);
  vec3 blue = vec3(0.090, 0.145, 0.329);
  vec3 teal = vec3(0.075, 0.306, 0.290);
  vec3 magenta = vec3(0.439, 0.102, 0.459);

  vec3 col = base;
  col = mix(col, violet, d1 * 0.8);
  col = mix(col, blue, d2 * 0.65);
  col += teal * crossBands * smoothstep(0.45, 0.9, n3 * 0.5 + 0.5) * 0.4;
  col += magenta * crossBands * smoothstep(0.55, 0.95, n1 * 0.5 + 0.5) * 0.5;

  float alpha = smoothstep(0.08, 0.95, d1 * 0.55 + d2 * 0.45 + band * 0.25) * 0.38;
  gl_FragColor = vec4(col, alpha);
}
`;

// Campo de estrellas con centelleo (V4 / G4 de repo-planets)
const STARS_VERT = `
precision highp float;
attribute vec3 position;
attribute float aSize;
attribute vec3 aColor;
attribute vec2 aTwinkle;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying vec3 vColor;
varying vec2 vTwinkle;
varying float vBoost;
void main() {
  vColor = aColor;
  vTwinkle = aTwinkle;
  vBoost = 1.0 + smoothstep(2.0, 2.6, aSize) * 0.9;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (280.0 / max(1.0, -mvPosition.z)), 1.0, 12.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const STARS_FRAG = `
precision highp float;
uniform float uTime;
varying vec3 vColor;
varying vec2 vTwinkle;
varying float vBoost;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float falloff = smoothstep(1.0, 0.0, d);
  falloff *= falloff;
  float brightness = 0.7 + 0.3 * sin(uTime * vTwinkle.y + vTwinkle.x);
  gl_FragColor = vec4(vColor * brightness * vBoost, falloff);
}
`;

// Sol: superficie convectiva (y4 / _4 de repo-planets)
const SUN_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform mat3 normalMatrix;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewPos;
void main() {
  vPos = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SUN_FRAG = `
precision highp float;
${NOISE_GLSL}
uniform float uTime;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewPos;
void main() {
  vec3 p = vPos;
  float base = fbm(p * 2.2 + vec3(uTime * 0.12, uTime * 0.08, -uTime * 0.06));
  float ridge = 1.0 - abs(fbm4(p * 4.6 - vec3(uTime * 0.06, 0.0, uTime * 0.1)));
  ridge = ridge * ridge;
  float heat = 0.5 + 0.5 * base;
  heat = clamp(heat * 0.72 + ridge * 0.42, 0.0, 1.0);

  vec3 ember = vec3(0.604, 0.204, 0.071);
  vec3 orange = vec3(0.961, 0.620, 0.043);
  vec3 hot = vec3(1.0, 0.969, 0.878);
  vec3 col = mix(ember, orange, smoothstep(0.12, 0.6, heat));
  col = mix(col, hot, smoothstep(0.64, 0.96, heat));
  col *= 1.15 + 0.55 * smoothstep(0.6, 0.98, heat);

  vec3 viewDir = normalize(-vViewPos);
  float mu = clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0);
  float limb = 0.6 + 0.4 * pow(mu, 0.85);
  col *= limb;
  col = mix(col * vec3(1.0, 0.7, 0.5), col, smoothstep(0.0, 0.45, mu));

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// Corona solar Fresnel (x4 / S4 de repo-planets)
const CORONA_FRAG = `
precision highp float;
${NOISE_GLSL}
uniform float uTime;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewPos;
void main() {
  vec3 viewDir = normalize(-vViewPos);
  vec3 n = normalize(vNormal);
  float rim = clamp(-dot(viewDir, n), 0.0, 1.0);
  float fresnel = pow(rim, 2.5);

  vec3 dir = normalize(vPos);
  float w1 = snoise(dir * 3.0 + vec3(0.0, uTime * 0.05, uTime * 0.035));
  float w2 = snoise(dir * 6.5 - vec3(uTime * 0.07, 0.0, uTime * 0.045));
  float wisp = 0.7 + 0.22 * w1 + 0.14 * w2;

  float intensity = fresnel * wisp;
  vec3 coronaColor = vec3(1.0, 0.68, 0.24);
  gl_FragColor = vec4(coronaColor * intensity, clamp(intensity * 0.95, 0.0, 1.0));
}
`;

// Brasas solares (M4 / w4 de repo-planets)
const EMBERS_VERT = `
precision highp float;
attribute vec3 position;
attribute float aPhase;
attribute float aSpeed;
attribute float aSize;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uTime;
uniform float uPixelRatio;
varying float vFlicker;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float f = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
  vFlicker = 0.18 + 0.82 * f * f;
  gl_PointSize = clamp(aSize * uPixelRatio * (260.0 / max(1.0, -mvPosition.z)) * (0.8 + 0.35 * vFlicker), 1.0, 24.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const EMBERS_FRAG = `
precision highp float;
varying float vFlicker;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  if (d > 1.0) discard;
  float falloff = smoothstep(1.0, 0.0, d);
  falloff *= falloff;
  vec3 cool = vec3(1.0, 0.42, 0.1);
  vec3 hot = vec3(1.0, 0.9, 0.55);
  vec3 col = mix(cool, hot, vFlicker);
  gl_FragColor = vec4(col * vFlicker, falloff * vFlicker);
}
`;

// Cinta orbital con estela luminosa (A4 / b4 de repo-planets)
const ORBIT_VERT = `
precision highp float;
attribute vec3 position;
attribute float aAngle;
attribute float aAcross;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying float vAngle;
varying float vAcross;
void main() {
  vAngle = aAngle;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ORBIT_FRAG = `
precision highp float;
uniform float uHead;
uniform vec3 uColor;
uniform float uSelected;
varying float vAngle;
varying float vAcross;
void main() {
  float d = mod(uHead - vAngle, 6.2831853);
  float trail = smoothstep(2.4, 0.0, d);
  float base = 0.08 + uSelected * 0.14;
  float edge = smoothstep(0.0, 0.25, vAcross) * smoothstep(1.0, 0.75, vAcross);
  float alpha = (base + trail * (0.55 + uSelected * 0.3)) * edge;
  vec3 col = uColor * (1.0 + trail * 0.8 + uSelected * 0.4);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;

// Planetas y lunas (s0 / N4 de repo-planets)
const PLANET_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vObjPos = position;
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PLANET_FRAG = `
precision highp float;
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
uniform float uType;
uniform float uHover;
uniform float uActivity;
uniform vec3 cameraPosition;
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(-vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 p = normalize(vObjPos);

  float ndl = dot(N, L);
  float diffuse = smoothstep(-0.12, 0.28, ndl);
  float light = 0.12 + 0.88 * diffuse;

  vec3 surf = uColor;
  vec3 emissive = vec3(0.0);
  float spec = 0.0;

  if (uType < 0.5) {
    // 0 = Gas giant (Júpiter / Saturno / Venus)
    float warp = fbm4(p * 1.5 + uSeed * 13.0 + vec3(uTime * 0.02, 0.0, 0.0));
    float band = fbm(vec3(p.x * 0.9 + uTime * 0.03, p.y * 4.0 + warp * 1.2, p.z * 0.9 + uSeed * 29.0));
    float bv = clamp(band * 0.65 + 0.5, 0.0, 1.0);
    vec3 dark = uColor * 0.45;
    vec3 lite = uColor * 1.25 + vec3(0.08);
    surf = mix(dark, lite, bv);

    vec3 sc1 = normalize(vec3(sin(uSeed * 40.0), 0.35 * sin(uSeed * 73.0), cos(uSeed * 40.0)));
    float sd1 = distance(p, sc1) + snoise(p * 6.0 + uSeed * 7.0) * 0.08;
    float storm1 = 1.0 - smoothstep(0.05, 0.32, sd1);
    surf += (uColor * 0.55 + vec3(0.12)) * storm1;
  } else if (uType < 1.5) {
    // 1 = Rocky world (Tierra: océano con brillo especular, continentes y casquetes polares)
    float h = fbm(p * 2.8 + uSeed * 17.0);
    float landMask = smoothstep(0.0, 0.05, h);
    vec3 ocean = vec3(0.08, 0.28, 0.62);
    vec3 lowland = vec3(0.16, 0.48, 0.26);
    vec3 midland = vec3(0.32, 0.56, 0.28);
    vec3 highland = vec3(0.62, 0.56, 0.44);
    float th = clamp(h * 1.8, 0.0, 1.0);
    vec3 land = mix(lowland, midland, smoothstep(0.05, 0.5, th));
    land = mix(land, highland, smoothstep(0.5, 0.9, th));
    surf = mix(ocean, land, landMask);
    vec3 R = reflect(-L, N);
    spec = pow(max(dot(R, V), 0.0), 24.0) * (1.0 - landMask) * 0.8;
    float capEdge = snoise(p * 4.0 + uSeed * 23.0) * 0.1;
    float cap = smoothstep(0.72, 0.85, abs(p.y) + capEdge);
    surf = mix(surf, vec3(0.93, 0.96, 1.0), cap);
  } else if (uType < 2.5) {
    // 2 = Marte (óxido de hierro, mesetas basálticas, cañones y casquetes polares)
    float h = fbm(p * 3.0 + uSeed * 19.0);
    float canyon = 1.0 - abs(snoise(p * 4.2 + uSeed * 11.0));
    canyon = pow(canyon, 5.0);
    vec3 darkPlain = uColor * 0.52;
    vec3 ochre = uColor * 1.08;
    vec3 brightDust = mix(uColor, vec3(0.98, 0.74, 0.52), 0.45);
    surf = mix(darkPlain, ochre, smoothstep(-0.25, 0.25, h));
    surf = mix(surf, brightDust, smoothstep(0.25, 0.65, h));
    surf *= 1.0 - canyon * 0.28;
    float capEdge = snoise(p * 4.5 + uSeed * 23.0) * 0.08;
    float cap = smoothstep(0.78, 0.88, abs(p.y) + capEdge);
    surf = mix(surf, vec3(0.95, 0.94, 0.92), cap);
  } else if (uType < 3.5) {
    // 3 = Nave / Estación / Rover (estructura tecnológica con paneles y baliza activa)
    float panel = step(0.15, abs(sin(p.x * 18.0)) * abs(sin(p.z * 18.0)));
    surf = mix(uColor * 0.35, uColor * 1.15, panel);
    float pulse = 0.65 + 0.35 * sin(uTime * 3.2 + uSeed * 10.0);
    emissive = uColor * 0.45 * pulse;
    vec3 R = reflect(-L, N);
    spec = pow(max(dot(R, V), 0.0), 16.0) * 0.9;
  } else {
    // 4 = Dead / Lunar regolith (gris craterizado de repo-planets)
    surf = mix(uColor, vec3(0.62), 0.75);
    float c1 = smoothstep(0.42, 0.74, snoise(p * 5.0 + uSeed * 31.0));
    float c2 = smoothstep(0.48, 0.78, snoise(p * 9.0 - uSeed * 13.0));
    surf *= 1.0 - c1 * 0.30 - c2 * 0.20;
    surf += vec3(fbm4(p * 3.0 + uSeed * 9.0) * 0.07);
  }

  vec3 col = surf * light + vec3(spec * diffuse) + emissive;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uColor * fres * (0.22 + uHover * 1.1);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// Halo atmosférico Fresnel (D4 de repo-planets)
const ATMO_FRAG = `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uHover;
uniform vec3 cameraPosition;
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(-vWorldPos);
  float fres = pow(clamp(1.0 + dot(N, V), 0.0, 1.0), 3.0);
  float day = 0.45 + 0.75 * smoothstep(-0.4, 0.6, dot(N, L));
  float intensity = uIntensity * (1.0 + uHover * 0.9);
  vec3 col = uColor * fres * intensity * day;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(fres * intensity, 0.0, 0.85));
}
`;

// Capa de nubes (U4 de repo-planets)
const CLOUD_FRAG = `
precision highp float;
${NOISE_GLSL}
uniform float uSeed;
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(-vWorldPos);
  float diffuse = smoothstep(-0.08, 0.25, dot(N, L));
  float light = 0.12 + 0.88 * diffuse;
  vec3 p = normalize(vObjPos);
  float c = fbm(p * 3.5 + uSeed * 23.0);
  float alpha = smoothstep(0.1, 0.65, c) * 0.52;
  gl_FragColor = vec4(vec3(light), alpha);
}
`;

// Anillos planetarios (O4 / z4 de repo-planets)
const RING_VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uInner;
uniform float uOuter;
varying float vR;
void main() {
  vR = (length(position.xy) - uInner) / max(0.001, uOuter - uInner);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = `
precision highp float;
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uSeed;
varying float vR;
void main() {
  float bands = snoise(vec3(vR * 16.0 + uSeed * 47.0, uSeed * 9.0, 0.0));
  float fine = snoise(vec3(vR * 60.0 - uSeed * 31.0, uSeed * 5.0, 0.0));
  float a = clamp(smoothstep(-0.35, 0.7, bands) * 0.6 + fine * 0.08, 0.0, 0.65);
  a *= smoothstep(0.0, 0.1, vR) * (1.0 - smoothstep(0.88, 1.0, vR));
  vec3 col = mix(uColor, vec3(1.0), 0.4);
  gl_FragColor = vec4(col * 0.9, a);
}
`;

// Shader para vehículos y estaciones 3D (Estación Espacial ISS, Rover Presurizado y Nave Orion)
const CRAFT_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute float aPart;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying float vPart;
void main() {
  vObjPos = position;
  vPart = aPart;
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CRAFT_FRAG = `
precision highp float;
uniform vec3 uColor;
uniform float uTime;
uniform float uHover;
uniform vec3 cameraPosition;
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying float vPart;
void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(-vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, L);
  float light = 0.28 + 0.72 * smoothstep(-0.2, 0.45, ndl);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), 22.0);

  vec3 baseCol = vec3(0.88, 0.91, 0.95);
  vec3 emissive = vec3(0.0);

  if (vPart < 0.5) {
    // 0 = Casco / módulos presurizados (blanco aeroespacial / titanio con juntas)
    float seam = step(0.12, abs(sin(vObjPos.x * 10.0)) * abs(sin(vObjPos.z * 10.0)));
    baseCol = mix(vec3(0.58, 0.64, 0.72), vec3(0.92, 0.95, 0.98), seam);
    spec *= 0.65;
  } else if (vPart < 1.5) {
    // 1 = Paneles solares fotovoltaicos (azul cobalto / dorado con celdas)
    float cellX = step(0.08, abs(sin(vObjPos.x * 26.0)));
    float cellZ = step(0.08, abs(sin(vObjPos.z * 26.0 + vObjPos.y * 26.0)));
    float grid = cellX * cellZ;
    vec3 cellCol = mix(vec3(0.08, 0.24, 0.58), uColor * 0.85 + vec3(0.12, 0.25, 0.45), 0.45);
    vec3 frameCol = vec3(0.85, 0.68, 0.24);
    baseCol = mix(frameCol, cellCol, grid);
    emissive = cellCol * 0.22;
    spec *= 1.35;
  } else if (vPart < 2.5) {
    // 2 = Ruedas, chasis rocker-bogie, viga truss y tobera (aleación oscura / dorado MLI)
    float tread = step(0.0, sin((vObjPos.x + vObjPos.y + vObjPos.z) * 28.0));
    baseCol = mix(vec3(0.16, 0.19, 0.24), vec3(0.32, 0.36, 0.42), tread * 0.5);
    spec *= 0.45;
  } else {
    // 3 = Visor de cabina / cúpula / antena / baliza activa luminosa
    float pulse = 0.7 + 0.3 * sin(uTime * 3.6);
    baseCol = mix(uColor, vec3(0.75, 0.95, 1.0), 0.45);
    emissive = baseCol * (0.75 * pulse + uHover * 0.45);
    spec *= 1.6;
  }

  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  vec3 col = baseCol * light + vec3(spec * 0.55) + emissive + uColor * fres * (0.28 + uHover * 0.85);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/* ───────────────────────── Iconos SVG por entorno (Estación, Rover, Nave, Base, Luna) ───────────────────────── */

export const ENV_ICONS = {
  // Rover presurizado: cabina con parabrisas, suspensión rocker-bogie, 3 ruedas, mástil óptico y antena parabólica
  rover: `<svg class="av-env-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 6.5V3.5M3.5 3.5h3" />
    <path d="M15.5 7l2-2.5m0 0h2m-2 0v2" />
    <path d="M3.5 13.5V9.5a2 2 0 0 1 2-2h9.2a2.5 2.5 0 0 1 2.1 1.15l2.2 3.35a1.5 1.5 0 0 1 .25.83v.67a1 1 0 0 1-1 1H3.5Z" fill="currentColor" fill-opacity="0.16" />
    <path d="M12.5 7.5v6M12.5 10.5h6.2" />
    <rect x="5.5" y="9.2" width="4.8" height="2.6" rx="0.6" />
    <path d="M5.5 14.5l-1 2.2M12 14.5v2.2M16.5 14.5l1 2.2M6 16.5h11" />
    <circle cx="4.5" cy="18.5" r="2.2" fill="currentColor" fill-opacity="0.25" />
    <circle cx="12" cy="18.5" r="2.2" fill="currentColor" fill-opacity="0.25" />
    <circle cx="18" cy="18.5" r="2.2" fill="currentColor" fill-opacity="0.25" />
  </svg>`,

  // Estación espacial (ISS / LEO): viga central truss, módulo presurizado central con nodo y 4 paneles solares segmentados
  station: `<svg class="av-env-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="1.5" y1="12" x2="22.5" y2="12" />
    <rect x="2" y="4" width="4.2" height="6.2" rx="0.5" fill="currentColor" fill-opacity="0.18" />
    <rect x="2" y="13.8" width="4.2" height="6.2" rx="0.5" fill="currentColor" fill-opacity="0.18" />
    <line x1="2" y1="7.1" x2="6.2" y2="7.1" />
    <line x1="2" y1="16.9" x2="6.2" y2="16.9" />
    <rect x="17.8" y="4" width="4.2" height="6.2" rx="0.5" fill="currentColor" fill-opacity="0.18" />
    <rect x="17.8" y="13.8" width="4.2" height="6.2" rx="0.5" fill="currentColor" fill-opacity="0.18" />
    <line x1="17.8" y1="7.1" x2="22" y2="7.1" />
    <line x1="17.8" y1="16.9" x2="22" y2="16.9" />
    <rect x="9.5" y="7" width="5" height="10" rx="1.6" fill="currentColor" fill-opacity="0.24" />
    <circle cx="12" cy="12" r="1.3" />
    <path d="M12 4.5v2.5M12 17v2.5" />
  </svg>`,

  // Nave espacial (Orion / tránsito en espacio profundo): cápsula cónica + módulo de servicio + alas solares en X
  spacecraft: `<svg class="av-env-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 2.5 8.5 9.5h7L12 2.5Z" fill="currentColor" fill-opacity="0.22" />
    <rect x="8.8" y="9.5" width="6.4" height="5.5" rx="0.8" fill="currentColor" fill-opacity="0.15" />
    <path d="M10.2 15l-1 2.8h5.6L13.8 15" />
    <path d="M8.8 11.2 2.5 8.2l-1 2.2 7.3 3M15.2 11.2l6.3-3 1 2.2-7.3 3" />
    <path d="M8.8 13.5 3 16.8l1 2 4.8-2.8M15.2 13.5l5.8 3.3-1 2-4.8-2.8" />
    <circle cx="12" cy="7.2" r="1" />
  </svg>`,

  // Base planetaria (Marte): cúpula geodésica presurizada + esclusa + antena parabólica sobre superficie
  base: `<svg class="av-env-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 19.5h20" />
    <path d="M4.5 19.5a7.5 7.5 0 0 1 15 0" fill="currentColor" fill-opacity="0.18" />
    <path d="M8 12.8h8M12 12v7.5" />
    <rect x="10" y="15.5" width="4" height="4" rx="0.6" />
    <path d="M17.5 9.5l2.5-2.5M18 6.5h2.5V9" />
  </svg>`,

  // Superficie lunar: globo lunar craterizado con baliza polar
  moon: `<svg class="av-env-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12.5" r="8" fill="currentColor" fill-opacity="0.16" />
    <circle cx="9.2" cy="10.5" r="1.6" />
    <circle cx="14.5" cy="14" r="2.1" />
    <circle cx="10.5" cy="15.8" r="1" />
    <path d="M12 2v2.5M9.5 3.2h5" />
  </svg>`,

  // Tierra (referencia MCC)
  earth: `<svg class="av-env-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity="0.15" />
    <path d="M4.5 9.5h15M4.5 14.5h15M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" />
  </svg>`,
};

export function getEnvIconSVG(key) {
  return ENV_ICONS[key] || ENV_ICONS.spacecraft;
}

/* ───────────────────────── Utilidades matemáticas y PRNG ───────────────────────── */

function mulberry32(seed) {
  let e = seed >>> 0;
  return function () {
    e |= 0;
    e = (e + 0x6d2b79f5) | 0;
    let t = Math.imul(e ^ (e >>> 15), 1 | e);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function mat4Perspective(fovRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4LookAt(eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4Compose(pos, rotX, rotY, rotZ, scale) {
  const cx = Math.cos(rotX), sx = Math.sin(rotX);
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const cz = Math.cos(rotZ), sz = Math.sin(rotZ);
  const sxScale = Array.isArray(scale) ? scale[0] : scale;
  const syScale = Array.isArray(scale) ? scale[1] : scale;
  const szScale = Array.isArray(scale) ? scale[2] : scale;
  const m = new Float32Array(16);
  m[0] = (cy * cz) * sxScale;
  m[1] = (cy * sz) * sxScale;
  m[2] = (-sy) * sxScale;
  m[3] = 0;
  m[4] = (sx * sy * cz - cx * sz) * syScale;
  m[5] = (sx * sy * sz + cx * cz) * syScale;
  m[6] = (sx * cy) * syScale;
  m[7] = 0;
  m[8] = (cx * sy * cz + sx * sz) * szScale;
  m[9] = (cx * sy * sz - sx * cz) * szScale;
  m[10] = (cx * cy) * szScale;
  m[11] = 0;
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
  m[15] = 1;
  return m;
}

function mat3FromMat4(m) {
  return new Float32Array([
    m[0], m[1], m[2],
    m[4], m[5], m[6],
    m[8], m[9], m[10],
  ]);
}

function projectToScreen(worldPos, viewProj, width, height) {
  const x = worldPos[0], y = worldPos[1], z = worldPos[2];
  const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  const cz = viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14];
  const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (cw <= 0.05) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1.0 - (ndcY * 0.5 + 0.5)) * height,
    z: ndcZ,
    w: cw,
  };
}

/* ───────────────────────── Constructores de geometría WebGL ───────────────────────── */

function createSphereGeometry(gl, radius = 1, widthSegments = 40, heightSegments = 28) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const phi = v * Math.PI;
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const theta = u * Math.PI * 2;
      const nx = -Math.cos(theta) * Math.sin(phi);
      const ny = Math.cos(phi);
      const nz = Math.sin(theta) * Math.sin(phi);
      positions.push(radius * nx, radius * ny, radius * nz);
      normals.push(nx, ny, nz);
    }
  }
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    position: createBuffer(gl, new Float32Array(positions)),
    normal: createBuffer(gl, new Float32Array(normals)),
    index: createIndexBuffer(gl, new Uint16Array(indices)),
    count: indices.length,
  };
}

function createRingGeometry(gl, innerRadius, outerRadius, segments = 72) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta), s = Math.sin(theta);
    positions.push(c * innerRadius, s * innerRadius, 0);
    positions.push(c * outerRadius, s * outerRadius, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return {
    position: createBuffer(gl, new Float32Array(positions)),
    index: createIndexBuffer(gl, new Uint16Array(indices)),
    count: indices.length,
  };
}

function createCompositeBuilder() {
  const positions = [];
  const normals = [];
  const parts = [];
  const indices = [];

  function addBox(cx, cy, cz, sx, sy, sz, partId = 0) {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const faces = [
      { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
      { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
      { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
      { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    ];
    for (const f of faces) {
      const base = positions.length / 3;
      for (const p of f.v) {
        positions.push(cx + p[0], cy + p[1], cz + p[2]);
        normals.push(f.n[0], f.n[1], f.n[2]);
        parts.push(partId);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // Cilindro orientado en el eje indicado ('x', 'y' o 'z')
  function addCylinder(cx, cy, cz, rTop, rBot, len, axis = "y", segs = 16, partId = 0) {
    const half = len * 0.5;
    const base = positions.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      for (let j = 0; j < 2; j++) {
        const r = j === 0 ? rTop : rBot;
        const h = j === 0 ? half : -half;
        let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
        if (axis === "x") {
          px = h; py = c * r; pz = s * r;
          nx = 0; ny = c; nz = s;
        } else if (axis === "z") {
          px = c * r; py = s * r; pz = h;
          nx = c; ny = s; nz = 0;
        } else {
          px = c * r; py = h; pz = s * r;
          nx = c; ny = 0; nz = s;
        }
        positions.push(cx + px, cy + py, cz + pz);
        normals.push(nx, ny, nz);
        parts.push(partId);
      }
    }
    for (let i = 0; i < segs; i++) {
      const k = base + i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }

  function finish(gl) {
    return {
      position: createBuffer(gl, new Float32Array(positions)),
      normal: createBuffer(gl, new Float32Array(normals)),
      aPart: createBuffer(gl, new Float32Array(parts)),
      index: createIndexBuffer(gl, new Uint16Array(indices)),
      count: indices.length,
    };
  }

  return { addBox, addCylinder, finish };
}

// Geometría 3D para Estación Espacial (ISS: viga truss, módulos presurizados, cúpula y 8 alas solares)
function createSpaceStationGeometry(gl) {
  const b = createCompositeBuilder();
  // Viga principal Integrated Truss Structure (eje X)
  b.addBox(0, 0, 0, 3.6, 0.14, 0.16, 2);
  // Módulos presurizados principales (Destiny / Harmony / Zvezda a lo largo de Z)
  b.addCylinder(0, 0, 0, 0.28, 0.28, 1.9, "z", 16, 0);
  // Módulos transversales (Columbus / Kibo)
  b.addCylinder(0, 0, 0.35, 0.22, 0.22, 1.25, "x", 14, 0);
  // Cúpula / nodo central luminoso
  b.addBox(0, 0.26, 0.15, 0.32, 0.22, 0.32, 3);
  // 4 pares de grandes paneles solares fotovoltaicos (izquierda y derecha)
  const wingXs = [-1.55, -1.05, 1.05, 1.55];
  for (const wx of wingXs) {
    // Mástil del panel
    b.addBox(wx, 0, 0, 0.06, 2.35, 0.06, 2);
    // Ala solar superior e inferior (partId = 1 → celdas solares)
    b.addBox(wx, 0.68, 0, 0.36, 0.96, 0.03, 1);
    b.addBox(wx, -0.68, 0, 0.36, 0.96, 0.03, 1);
  }
  // Paneles radiadores térmicos blancos
  b.addBox(-0.52, -0.05, -0.55, 0.28, 0.03, 0.75, 0);
  b.addBox(0.52, -0.05, -0.55, 0.28, 0.03, 0.75, 0);
  return b.finish(gl);
}

// Geometría 3D para Rover Presurizado (cabina presurizada, visor frontal, 6 ruedas rocker-bogie, mástil y antena)
function createRoverGeometry(gl) {
  const b = createCompositeBuilder();
  // Cabina presurizada principal
  b.addBox(0, 0.18, 0, 1.55, 0.68, 1.02, 0);
  // Techo / cubierta solar superior
  b.addBox(-0.08, 0.56, 0, 1.18, 0.06, 0.88, 1);
  // Parabrisas / visor frontal panorámico iluminado (hacia +X)
  b.addBox(0.76, 0.24, 0, 0.14, 0.38, 0.78, 3);
  // Esclusa / suitport trasero (hacia -X)
  b.addBox(-0.84, 0.16, 0, 0.22, 0.52, 0.64, 0);
  // Chasis inferior y brazos de suspensión rocker-bogie
  b.addBox(0, -0.18, 0, 1.45, 0.14, 0.76, 2);
  b.addBox(0, -0.26, 0.54, 1.38, 0.08, 0.08, 2);
  b.addBox(0, -0.26, -0.54, 1.38, 0.08, 0.08, 2);
  // 6 ruedas todoterreno (3 por lado)
  const wheelXs = [-0.62, 0.0, 0.62];
  const wheelZs = [-0.64, 0.64];
  for (const wx of wheelXs) {
    for (const wz of wheelZs) {
      b.addCylinder(wx, -0.34, wz, 0.26, 0.26, 0.20, "z", 14, 2);
      // Tapacubos / eje metálico
      b.addCylinder(wx, -0.34, wz, 0.11, 0.11, 0.23, "z", 10, 0);
    }
  }
  // Mástil de cámara y navegación + cabezal óptico
  b.addCylinder(0.46, 0.78, 0.24, 0.045, 0.045, 0.48, "y", 10, 2);
  b.addBox(0.46, 1.04, 0.24, 0.20, 0.14, 0.24, 3);
  // Antena parabólica de alta ganancia en popa
  b.addCylinder(-0.52, 0.74, -0.22, 0.04, 0.04, 0.36, "y", 10, 2);
  b.addCylinder(-0.52, 0.94, -0.22, 0.26, 0.06, 0.12, "y", 14, 3);
  return b.finish(gl);
}

// Geometría 3D para Nave Espacial en tránsito (cápsula cónica Orion + módulo de servicio + 4 alas solares en X)
function createSpacecraftGeometry(gl) {
  const b = createCompositeBuilder();
  // Módulo de servicio cilíndrico
  b.addCylinder(0, 0, -0.15, 0.46, 0.46, 0.92, "z", 16, 0);
  // Cápsula cónica de tripulación (hacia +Z)
  b.addCylinder(0, 0, 0.56, 0.18, 0.48, 0.58, "z", 16, 0);
  // Ventanilla / escotilla luminosa de la cápsula
  b.addBox(0, 0.28, 0.55, 0.22, 0.14, 0.22, 3);
  // Tobera del motor orbital principal (hacia -Z)
  b.addCylinder(0, 0, -0.76, 0.14, 0.28, 0.36, "z", 14, 2);
  // 4 paneles solares desplegados en X
  b.addBox(1.15, 0.55, -0.2, 1.45, 0.04, 0.34, 1);
  b.addBox(-1.15, 0.55, -0.2, 1.45, 0.04, 0.34, 1);
  b.addBox(1.15, -0.55, -0.2, 1.45, 0.04, 0.34, 1);
  b.addBox(-1.15, -0.55, -0.2, 1.45, 0.04, 0.34, 1);
  return b.finish(gl);
}

function createOrbitRibbonGeometry(gl, a, e = 0.04, widthFactor = 0.0055, segments = 200) {
  const b = a * Math.sqrt(Math.max(0.01, 1 - e * e));
  const halfW = Math.max(0.055, a * widthFactor);
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const angles = new Float32Array(vertCount);
  const across = new Float32Array(vertCount);
  const indices = new Uint16Array(segments * 6);

  for (let i = 0; i <= segments; i++) {
    const w = (i / segments) * Math.PI * 2;
    const x = Math.cos(w) * a;
    const z = Math.sin(w) * b;
    const len = Math.hypot(x, z) || 1;
    const nx = x / len, nz = z / len;
    const idx = i * 2;
    positions[idx * 3 + 0] = x - nx * halfW;
    positions[idx * 3 + 1] = 0;
    positions[idx * 3 + 2] = z - nz * halfW;
    positions[(idx + 1) * 3 + 0] = x + nx * halfW;
    positions[(idx + 1) * 3 + 1] = 0;
    positions[(idx + 1) * 3 + 2] = z + nz * halfW;
    angles[idx] = w;
    angles[idx + 1] = w;
    across[idx] = 0;
    across[idx + 1] = 1;
  }
  for (let i = 0; i < segments; i++) {
    const w = i * 2, x = i * 6;
    indices[x + 0] = w;
    indices[x + 1] = w + 1;
    indices[x + 2] = w + 2;
    indices[x + 3] = w + 1;
    indices[x + 4] = w + 3;
    indices[x + 5] = w + 2;
  }
  return {
    position: createBuffer(gl, positions),
    aAngle: createBuffer(gl, angles),
    aAcross: createBuffer(gl, across),
    index: createIndexBuffer(gl, indices),
    count: indices.length,
  };
}

function createStarfieldBuffers(gl, count = 2800) {
  const rng = mulberry32(1369960929 + count);
  const palette = [
    { color: [0.792, 0.843, 1.0], weight: 0.3 },
    { color: [0.973, 0.969, 1.0], weight: 0.25 },
    { color: [1.0, 0.957, 0.918], weight: 0.25 },
    { color: [1.0, 0.824, 0.631], weight: 0.12 },
    { color: [1.0, 0.8, 0.624], weight: 0.08 },
  ];
  const pickColor = () => {
    const r = rng();
    let acc = 0;
    for (let i = 0; i < palette.length; i++) {
      acc += palette[i].weight;
      if (r <= acc) return palette[i].color;
    }
    return palette[0].color;
  };
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const twinkles = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const u = rng() * 2 - 1;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const rad = 110 + rng() * 240;
    positions[i * 3 + 0] = rad * s * Math.cos(theta);
    positions[i * 3 + 1] = rad * u;
    positions[i * 3 + 2] = rad * s * Math.sin(theta);
    const t = rng();
    sizes[i] = 0.8 + 2.2 * t * t * t;
    const c = pickColor();
    const b = 0.9 + rng() * 0.2;
    colors[i * 3 + 0] = Math.min(1, c[0] * b);
    colors[i * 3 + 1] = Math.min(1, c[1] * b);
    colors[i * 3 + 2] = Math.min(1, c[2] * b);
    twinkles[i * 2 + 0] = rng() * Math.PI * 2;
    twinkles[i * 2 + 1] = 0.5 + rng() * 2.5;
  }
  return {
    position: createBuffer(gl, positions),
    aSize: createBuffer(gl, sizes),
    aColor: createBuffer(gl, colors),
    aTwinkle: createBuffer(gl, twinkles),
    count,
  };
}

function createSolarEmbersBuffers(gl, count = 48) {
  const rng = mulberry32(2166136261);
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const u = rng() * 2 - 1;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const r = 2.45 + rng() * 0.55;
    positions[i * 3 + 0] = s * Math.cos(theta) * r;
    positions[i * 3 + 1] = u * r;
    positions[i * 3 + 2] = s * Math.sin(theta) * r;
    phases[i] = rng() * Math.PI * 2;
    speeds[i] = 0.6 + rng() * 1.3;
    sizes[i] = 0.35 + rng() * 0.45;
  }
  return {
    position: createBuffer(gl, positions),
    aPhase: createBuffer(gl, phases),
    aSpeed: createBuffer(gl, speeds),
    aSize: createBuffer(gl, sizes),
    count,
  };
}

function createAsteroidBeltBuffers(gl, innerR = 23.0, outerR = 26.2, count = 520) {
  const rng = mulberry32(48663);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const twinkles = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const p = (rng() + rng()) * 0.5;
    const r = innerR + p * (outerR - innerR);
    const a = rng() * Math.PI * 2;
    const y = (rng() + rng() - 1.0) * 0.65;
    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * r;
    sizes[i] = 1.1 + rng() * 1.6;
    const shade = 0.48 + rng() * 0.25;
    colors[i * 3 + 0] = shade * 1.05;
    colors[i * 3 + 1] = shade * 0.96;
    colors[i * 3 + 2] = shade * 0.90;
    twinkles[i * 2 + 0] = rng() * Math.PI * 2;
    twinkles[i * 2 + 1] = 0.2;
  }
  return {
    position: createBuffer(gl, positions),
    aSize: createBuffer(gl, sizes),
    aColor: createBuffer(gl, colors),
    aTwinkle: createBuffer(gl, twinkles),
    count,
  };
}

function createBuffer(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

function createIndexBuffer(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

function compileProgram(gl, vsSource, fsSource) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(info || "Shader compile error");
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || "Program link error");
  }
  return prog;
}

function bindAttr(gl, prog, name, buffer, size) {
  const loc = gl.getAttribLocation(prog, name);
  if (loc < 0 || !buffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

/* ───────────────────────── Catálogo del Sistema Solar + 5 entornos SEMSA ───────────────────────── */

const SOLAR_BODIES = [
  {
    id: "mercury",
    envKey: null,
    orbitRadius: 5.2,
    eccentricity: 0.08,
    orbitSpeed: 0.22,
    initialAngle: 0.8,
    inclination: 0.05,
    size: 0.42,
    uType: 4, // cratered
    color: "#9ca3af",
    seed: 0.14,
    rotationSpeed: 0.3,
    atmosphere: false,
    clouds: false,
    rings: false,
    camDist: 3.0,
    camElev: 0.35,
  },
  {
    id: "venus",
    envKey: null,
    orbitRadius: 8.0,
    eccentricity: 0.02,
    orbitSpeed: 0.15,
    initialAngle: 2.3,
    inclination: 0.03,
    size: 0.72,
    uType: 0, // gas/banded clouds
    color: "#eab308",
    seed: 0.31,
    rotationSpeed: -0.18,
    atmosphere: true,
    clouds: false,
    rings: false,
    camDist: 3.4,
    camElev: 0.35,
  },
  {
    id: "earth",
    envKey: null,
    orbitRadius: 12.2,
    eccentricity: 0.02,
    orbitSpeed: 0.105,
    initialAngle: 4.1,
    inclination: 0.0,
    size: 0.92,
    uType: 1, // rocky Earth
    color: "#3b82f6",
    seed: 0.52,
    rotationSpeed: 0.65,
    atmosphere: true,
    clouds: true,
    rings: false,
    camDist: 4.4,
    camElev: 0.38,
  },
  {
    id: "station",
    envKey: "station",
    parentId: "earth",
    orbitRadius: 1.52,
    eccentricity: 0.01,
    orbitSpeed: 0.95,
    initialAngle: 1.1,
    inclination: 0.28,
    size: 0.24,
    uType: 3, // tech station
    color: "#38bdf8",
    seed: 0.64,
    rotationSpeed: 0.8,
    atmosphere: true,
    clouds: false,
    rings: false,
    camDist: 2.9,
    camElev: 0.34,
  },
  {
    id: "moon",
    envKey: "moon",
    parentId: "earth",
    orbitRadius: 2.95,
    eccentricity: 0.04,
    orbitSpeed: 0.42,
    initialAngle: 3.6,
    inclination: 0.09,
    size: 0.38,
    uType: 4, // lunar regolith
    color: "#cbd5e1",
    seed: 0.77,
    rotationSpeed: 0.25,
    atmosphere: true,
    clouds: false,
    rings: false,
    camDist: 2.4,
    camElev: 0.32,
  },
  {
    id: "rover",
    envKey: "rover",
    parentId: "moon",
    orbitRadius: 0.68,
    eccentricity: 0.02,
    orbitSpeed: 0.85,
    initialAngle: 0.5,
    inclination: 0.45,
    size: 0.19,
    uType: 3, // pressurized rover beacon
    color: "#facc15",
    seed: 0.83,
    rotationSpeed: 0.7,
    atmosphere: true,
    clouds: false,
    rings: false,
    camDist: 1.95,
    camElev: 0.36,
  },
  {
    id: "spacecraft",
    envKey: "spacecraft",
    orbitRadius: 15.8,
    eccentricity: 0.16,
    orbitSpeed: 0.082,
    initialAngle: 5.15,
    inclination: 0.08,
    size: 0.36,
    uType: 3, // deep-space transit craft
    color: "#a78bfa",
    seed: 0.44,
    rotationSpeed: 0.9,
    atmosphere: true,
    clouds: false,
    rings: false,
    camDist: 2.8,
    camElev: 0.35,
  },
  {
    id: "base",
    envKey: "base",
    orbitRadius: 19.6,
    eccentricity: 0.06,
    orbitSpeed: 0.068,
    initialAngle: 1.85,
    inclination: 0.04,
    size: 0.78,
    uType: 2, // Martian surface
    color: "#ea580c",
    seed: 0.91,
    rotationSpeed: 0.58,
    atmosphere: true,
    clouds: false,
    rings: false,
    camDist: 3.2,
    camElev: 0.36,
  },
  {
    id: "jupiter",
    envKey: null,
    orbitRadius: 29.2,
    eccentricity: 0.04,
    orbitSpeed: 0.038,
    initialAngle: 2.9,
    inclination: 0.02,
    size: 1.55,
    uType: 0, // gas giant
    color: "#d97706",
    seed: 0.23,
    rotationSpeed: 1.1,
    atmosphere: true,
    clouds: false,
    rings: false,
    camDist: 5.5,
    camElev: 0.35,
  },
  {
    id: "saturn",
    envKey: null,
    orbitRadius: 35.8,
    eccentricity: 0.05,
    orbitSpeed: 0.026,
    initialAngle: 5.7,
    inclination: 0.05,
    size: 1.28,
    uType: 0, // gas giant with rings
    color: "#eab308",
    seed: 0.68,
    rotationSpeed: 0.95,
    atmosphere: true,
    clouds: false,
    rings: true,
    camDist: 6.2,
    camElev: 0.4,
  },
];

/* ───────────────────────── Montaje del Sistema Solar 3D ───────────────────────── */

export function mountSolarSystem(hostEl, { initialEnv = "moon", getLabels, onSelectEnv } = {}) {
  if (!hostEl) return null;

  hostEl.innerHTML = `
    <div class="av-env-solar-stage" data-solar-stage>
      <canvas class="av-env-solar-canvas" data-solar-canvas aria-label="Sistema Solar 3D interactivo"></canvas>
      <div class="av-env-solar-hud">
        <div class="av-env-solar-target" data-solar-target></div>
        <div class="av-env-solar-actions">
          <button type="button" class="av-btn av-btn-sm av-env-solar-btn" data-solar-mode="focus" aria-pressed="true"></button>
          <button type="button" class="av-btn av-btn-sm av-env-solar-btn" data-solar-mode="overview" aria-pressed="false"></button>
        </div>
      </div>
      <div class="av-env-solar-markers" data-solar-markers></div>
      <div class="av-env-solar-dock" role="toolbar" aria-label="Ubicaciones del Sistema Solar" data-solar-dock></div>
      <div class="av-env-solar-tip" data-solar-tip hidden></div>
    </div>
  `;

  const stageEl = hostEl.querySelector("[data-solar-stage]");
  const canvas = hostEl.querySelector("[data-solar-canvas]");
  const targetHudEl = hostEl.querySelector("[data-solar-target]");
  const markersEl = hostEl.querySelector("[data-solar-markers]");
  const dockEl = hostEl.querySelector("[data-solar-dock]");
  const tipEl = hostEl.querySelector("[data-solar-tip]");
  const btnFocus = hostEl.querySelector('[data-solar-mode="focus"]');
  const btnOverview = hostEl.querySelector('[data-solar-mode="overview"]');

  const state = {
    envKey: initialEnv || "moon",
    overview: false,
    hoveredId: null,
    pointerX: 0,
    pointerY: 0,
    dragging: false,
    dragMoved: false,
    lastX: 0,
    lastY: 0,
    // Ángulos orbitales de cámara alrededor del objetivo actual
    yaw: 0.65,
    pitch: 0.42,
    zoomScale: 1.0,
    // Posición y objetivo suavizados de la cámara
    camPos: [0, 18, 34],
    camTarget: [0, 0, 0],
    transitionT: 0,
    camFromPos: [0, 22, 42],
    camFromTarget: [0, 0, 0],
    worldPositions: {},
    screenProjections: {},
    rafId: null,
    startTime: performance.now() * 0.001,
  };

  // Marcadores superpuestos para los 5 entornos + Sol/Tierra con iconos SVG específicos
  const markerNodes = {};
  SOLAR_BODIES.filter((b) => b.envKey || b.id === "earth").forEach((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `av-env-solar-pin${b.envKey ? " is-env" : ""}`;
    btn.dataset.bodyId = b.id;
    if (b.envKey) btn.dataset.envKey = b.envKey;
    btn.style.setProperty("--pin-color", b.color);
    const ico = getEnvIconSVG(b.envKey || b.id);
    btn.innerHTML = `<span class="av-env-solar-pin-ico" style="color:${b.color}">${ico}</span><span class="av-env-solar-pin-lbl"></span>`;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (b.envKey) {
        state.overview = false;
        syncModeButtons();
        if (typeof onSelectEnv === "function") onSelectEnv(b.envKey);
        else setEnvironment(b.envKey);
      }
    });
    btn.addEventListener("mouseenter", (ev) => {
      state.hoveredId = b.id;
      updateTooltip(ev.clientX, ev.clientY);
    });
    btn.addEventListener("mousemove", (ev) => {
      updateTooltip(ev.clientX, ev.clientY);
    });
    btn.addEventListener("mouseleave", () => {
      if (state.hoveredId === b.id) {
        state.hoveredId = null;
        tipEl.hidden = true;
      }
    });
    markersEl.appendChild(btn);
    markerNodes[b.id] = btn;
  });

  function syncModeButtons() {
    if (btnFocus) btnFocus.setAttribute("aria-pressed", String(!state.overview));
    if (btnOverview) btnOverview.setAttribute("aria-pressed", String(state.overview));
  }

  btnFocus?.addEventListener("click", () => {
    state.overview = false;
    state.zoomScale = 1.0;
    startCameraTransition();
    syncModeButtons();
    renderHudText();
  });

  btnOverview?.addEventListener("click", () => {
    state.overview = true;
    state.zoomScale = 1.0;
    startCameraTransition();
    syncModeButtons();
    renderHudText();
  });

  dockEl?.addEventListener("click", (ev) => {
    const pill = ev.target.closest("[data-solar-pick]");
    if (!pill) return;
    const k = pill.getAttribute("data-solar-pick");
    if (k === "all") {
      state.overview = true;
      state.zoomScale = 1.0;
      startCameraTransition();
      syncModeButtons();
      renderHudText();
      return;
    }
    state.overview = false;
    state.zoomScale = 1.0;
    syncModeButtons();
    if (typeof onSelectEnv === "function") onSelectEnv(k);
    else setEnvironment(k);
  });

  function startCameraTransition() {
    state.camFromPos = [...state.camPos];
    state.camFromTarget = [...state.camTarget];
    state.transitionT = 0.001;
  }

  function updateTooltip(clientX, clientY) {
    const b = SOLAR_BODIES.find((x) => x.id === state.hoveredId);
    if (!b || ! getLabels) {
      tipEl.hidden = true;
      return;
    }
    const L = getLabels();
    const info = L.bodies[b.id] || L.bodies[b.envKey] || { name: b.id, desc: "", facts: [] };
    const ico = getEnvIconSVG(b.envKey || b.id);
    tipEl.innerHTML = `
      <div class="av-env-solar-tipcard">
        <div class="av-env-solar-tiphead">
          <span class="av-env-solar-tipico" style="color:${b.color};border-color:${b.color}55">${ico}</span>
          <strong>${info.name}</strong>
          ${b.envKey === state.envKey ? `<span class="av-env-tag">${L.focusedTag}</span>` : ""}
        </div>
        <div class="av-env-solar-tipdesc">${info.desc || ""}</div>
        ${info.facts && info.facts.length ? `<div class="av-env-solar-tipfacts">${info.facts.map((f) => `<span class="av-env-solar-fact">${f}</span>`).join("")}</div>` : ""}
      </div>
    `;
    const rect = stageEl.getBoundingClientRect();
    const relX = Math.min(Math.max(12, clientX - rect.left + 14), Math.max(12, rect.width - 250));
    const relY = Math.min(Math.max(12, clientY - rect.top - 10), Math.max(12, rect.height - 130));
    tipEl.style.left = `${relX}px`;
    tipEl.style.top = `${relY}px`;
    tipEl.hidden = false;
  }

  function renderHudText() {
    if (!getLabels) return;
    const L = getLabels();
    if (btnFocus) btnFocus.textContent = L.btnFocus;
    if (btnOverview) btnOverview.textContent = L.btnOverview;

    const curBody = SOLAR_BODIES.find((b) => b.envKey === state.envKey) || SOLAR_BODIES[4];
    const bInfo = L.bodies[curBody.id] || { name: curBody.id, desc: "", facts: [] };
    const curIcon = getEnvIconSVG(curBody.envKey || curBody.id);
    if (targetHudEl) {
      targetHudEl.innerHTML = `
        <div class="av-env-solar-target-row">
          <div class="av-env-solar-emblem" style="--emblem-col:${curBody.color}" data-solar-emblem="${curBody.envKey || curBody.id}">
            ${curIcon}
          </div>
          <div class="av-env-solar-target-info">
            <div class="av-env-solar-kicker">
              <span class="av-env-solar-dot" style="background:${curBody.color}"></span>
              <span class="av-lbl">${state.overview ? L.overviewTitle : L.locatedAt}</span>
            </div>
            <div class="av-env-solar-name">${bInfo.name}</div>
            <div class="av-env-solar-meta">${(bInfo.facts || []).map((f) => `<span>${f}</span>`).join(" · ")}</div>
          </div>
        </div>
      `;
    }

    // Actualizar nombres de los pines 3D
    Object.entries(markerNodes).forEach(([id, btn]) => {
      const info = L.bodies[id];
      const lbl = btn.querySelector(".av-env-solar-pin-lbl");
      if (lbl && info) lbl.textContent = info.short || info.name;
      const body = SOLAR_BODIES.find((x) => x.id === id);
      const isSelected = body && body.envKey === state.envKey;
      btn.classList.toggle("is-active", !!isSelected);
    });

    // Barra inferior de acceso rápido a los 5 entornos con sus iconos
    if (dockEl) {
      const envBodies = SOLAR_BODIES.filter((b) => b.envKey);
      dockEl.innerHTML = envBodies.map((b) => {
        const info = L.bodies[b.id] || { name: b.id };
        const on = !state.overview && b.envKey === state.envKey;
        const ico = getEnvIconSVG(b.envKey);
        return `<button type="button" class="av-env-solar-pill${on ? " is-on" : ""}" data-solar-pick="${b.envKey}" aria-pressed="${on}">
          <span class="av-env-solar-pill-ico" style="color:${b.color}">${ico}</span>
          <span>${info.short || info.name}</span>
        </button>`;
      }).join("");
    }
  }

  // Controles de ratón / táctiles para rotar y hacer zoom alrededor del objetivo
  canvas.addEventListener("pointerdown", (ev) => {
    state.dragging = true;
    state.dragMoved = false;
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;
    canvas.setPointerCapture?.(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!state.dragging) return;
    const dx = ev.clientX - state.lastX;
    const dy = ev.clientY - state.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.dragMoved = true;
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;
    state.yaw -= dx * 0.0075;
    state.pitch = Math.max(-0.55, Math.min(1.28, state.pitch + dy * 0.0065));
  });
  canvas.addEventListener("pointerup", (ev) => {
    const wasClick = state.dragging && !state.dragMoved;
    state.dragging = false;
    canvas.releasePointerCapture?.(ev.pointerId);
    if (wasClick) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let hit = null;
      let bestD = 34;
      SOLAR_BODIES.forEach((b) => {
        if (!b.envKey) return;
        const p = state.screenProjections[b.id];
        if (!p) return;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          hit = b;
        }
      });
      if (hit && hit.envKey) {
        state.overview = false;
        syncModeButtons();
        if (typeof onSelectEnv === "function") onSelectEnv(hit.envKey);
        else setEnvironment(hit.envKey);
      }
    }
  });
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY > 0 ? 1.1 : 0.9;
    state.zoomScale = Math.max(0.55, Math.min(2.6, state.zoomScale * factor));
  }, { passive: false });

  // Inicializar WebGL
  const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
  if (!gl) {
    renderHudText();
    return {
      setEnvironment(k) {
        state.envKey = k;
        renderHudText();
      },
      refreshLabels: renderHudText,
      destroy() {},
    };
  }

  const programs = {
    nebula: compileProgram(gl, NEBULA_VERT, NEBULA_FRAG),
    stars: compileProgram(gl, STARS_VERT, STARS_FRAG),
    sun: compileProgram(gl, SUN_VERT, SUN_FRAG),
    corona: compileProgram(gl, SUN_VERT, CORONA_FRAG),
    embers: compileProgram(gl, EMBERS_VERT, EMBERS_FRAG),
    orbit: compileProgram(gl, ORBIT_VERT, ORBIT_FRAG),
    planet: compileProgram(gl, PLANET_VERT, PLANET_FRAG),
    craft: compileProgram(gl, CRAFT_VERT, CRAFT_FRAG),
    atmo: compileProgram(gl, PLANET_VERT, ATMO_FRAG),
    cloud: compileProgram(gl, PLANET_VERT, CLOUD_FRAG),
    ring: compileProgram(gl, RING_VERT, RING_FRAG),
  };

  const meshes = {
    skySphere: createSphereGeometry(gl, 420, 32, 24),
    unitSphere: createSphereGeometry(gl, 1.0, 40, 28),
    station: createSpaceStationGeometry(gl),
    rover: createRoverGeometry(gl),
    spacecraft: createSpacecraftGeometry(gl),
    stars: createStarfieldBuffers(gl, 2800),
    asteroids: createAsteroidBeltBuffers(gl, 23.0, 26.2, 520),
    embers: createSolarEmbersBuffers(gl, 48),
    saturnRing: createRingGeometry(gl, 1.45 * 1.28, 2.45 * 1.28, 72),
    orbits: {},
  };

  SOLAR_BODIES.forEach((b) => {
    meshes.orbits[b.id] = createOrbitRibbonGeometry(
      gl,
      b.orbitRadius,
      b.eccentricity,
      b.parentId ? 0.016 : 0.0055,
      b.parentId ? 120 : 200
    );
  });

  function updateWorldPositions(elapsed) {
    // 1. Cuerpos heliocéntricos
    SOLAR_BODIES.forEach((b) => {
      if (b.parentId) return;
      const semiMinor = b.orbitRadius * Math.sqrt(1 - b.eccentricity * b.eccentricity);
      const angle = b.initialAngle + elapsed * b.orbitSpeed;
      b._headAngle = angle;
      const x = Math.cos(angle) * b.orbitRadius;
      const z = Math.sin(angle) * semiMinor;
      const y = Math.sin(angle) * b.orbitRadius * Math.sin(b.inclination || 0);
      state.worldPositions[b.id] = [x, y, z];
    });
    // 2. Cuerpos con padre (Luna, Estación LEO, Rover)
    SOLAR_BODIES.forEach((b) => {
      if (!b.parentId) return;
      const parentPos = state.worldPositions[b.parentId] || [0, 0, 0];
      const semiMinor = b.orbitRadius * Math.sqrt(1 - b.eccentricity * b.eccentricity);
      const angle = b.initialAngle + elapsed * b.orbitSpeed;
      b._headAngle = angle;
      const lx = Math.cos(angle) * b.orbitRadius;
      const lz = Math.sin(angle) * semiMinor;
      const ly = Math.sin(angle) * b.orbitRadius * Math.sin(b.inclination || 0);
      state.worldPositions[b.id] = [
        parentPos[0] + lx,
        parentPos[1] + ly,
        parentPos[2] + lz,
      ];
    });
  }

  function renderFrame(nowMs) {
    if (!canvas.isConnected) return;
    const elapsed = nowMs * 0.001 - state.startTime;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.0118, 0.0, 0.0784, 1.0); // #030014 de repo-planets
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    updateWorldPositions(elapsed);

    // Calcular objetivo de cámara según el entorno seleccionado o vista general
    const focusBody = SOLAR_BODIES.find((b) => b.envKey === state.envKey) || SOLAR_BODIES[4];
    const targetCenter = state.overview
      ? [0, 0, 0]
      : (state.worldPositions[focusBody.id] || [0, 0, 0]);
    const dist = (state.overview ? 42.0 : (focusBody.camDist || 3.2)) * state.zoomScale;
    const yaw = state.yaw + elapsed * (state.overview ? 0.04 : 0.025);
    const pitch = state.overview ? Math.max(0.35, state.pitch) : state.pitch;

    const desiredPos = [
      targetCenter[0] + Math.cos(pitch) * Math.sin(yaw) * dist,
      targetCenter[1] + Math.sin(pitch) * dist,
      targetCenter[2] + Math.cos(pitch) * Math.cos(yaw) * dist,
    ];

    if (state.transitionT > 0 && state.transitionT < 1) {
      state.transitionT = Math.min(1, state.transitionT + 0.032);
      const k = easeInOutCubic(state.transitionT);
      for (let i = 0; i < 3; i++) {
        state.camPos[i] = state.camFromPos[i] + (desiredPos[i] - state.camFromPos[i]) * k;
        state.camTarget[i] = state.camFromTarget[i] + (targetCenter[i] - state.camFromTarget[i]) * k;
      }
    } else {
      for (let i = 0; i < 3; i++) {
        state.camPos[i] += (desiredPos[i] - state.camPos[i]) * 0.14;
        state.camTarget[i] += (targetCenter[i] - state.camTarget[i]) * 0.18;
      }
    }

    const proj = mat4Perspective((48 * Math.PI) / 180, w / h, 0.1, 1000.0);
    const view = mat4LookAt(state.camPos, state.camTarget, [0, 1, 0]);
    const viewProj = mat4Multiply(proj, view);

    // 1. Nebulosa de fondo
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    {
      const prog = programs.nebula;
      gl.useProgram(prog);
      const model = mat4Compose(state.camPos, 0, elapsed * 0.002, 0, 1);
      const mv = mat4Multiply(view, model);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, mv);
      gl.uniform1f(gl.getUniformLocation(prog, "uTime"), elapsed);
      bindAttr(gl, prog, "position", meshes.skySphere.position, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.skySphere.index);
      gl.drawElements(gl.TRIANGLES, meshes.skySphere.count, gl.UNSIGNED_SHORT, 0);
    }

    // 2. Campo de estrellas + cinturón de asteroides (aditivo)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    {
      const prog = programs.stars;
      gl.useProgram(prog);
      const starModel = mat4Compose([0, 0, 0], 0, elapsed * 0.002, 0, 1);
      const starMv = mat4Multiply(view, starModel);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, starMv);
      gl.uniform1f(gl.getUniformLocation(prog, "uTime"), elapsed);
      bindAttr(gl, prog, "position", meshes.stars.position, 3);
      bindAttr(gl, prog, "aSize", meshes.stars.aSize, 1);
      bindAttr(gl, prog, "aColor", meshes.stars.aColor, 3);
      bindAttr(gl, prog, "aTwinkle", meshes.stars.aTwinkle, 2);
      gl.drawArrays(gl.POINTS, 0, meshes.stars.count);

      // Cinturón de asteroides
      const beltModel = mat4Compose([0, 0, 0], 0, elapsed * 0.012, 0, 1);
      const beltMv = mat4Multiply(view, beltModel);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, beltMv);
      bindAttr(gl, prog, "position", meshes.asteroids.position, 3);
      bindAttr(gl, prog, "aSize", meshes.asteroids.aSize, 1);
      bindAttr(gl, prog, "aColor", meshes.asteroids.aColor, 3);
      bindAttr(gl, prog, "aTwinkle", meshes.asteroids.aTwinkle, 2);
      gl.drawArrays(gl.POINTS, 0, meshes.asteroids.count);
    }

    // 3. Cintas orbitales (A4 / b4)
    {
      const prog = programs.orbit;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      SOLAR_BODIES.forEach((b) => {
        const parentPos = b.parentId ? (state.worldPositions[b.parentId] || [0, 0, 0]) : [0, 0, 0];
        const model = mat4Compose(parentPos, b.inclination || 0, 0, 0, 1);
        const mv = mat4Multiply(view, model);
        const rgb = hexToRgb(b.color);
        const isSel = b.envKey && b.envKey === state.envKey ? 1.0 : 0.0;
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, mv);
        gl.uniform1f(gl.getUniformLocation(prog, "uHead"), b._headAngle || 0);
        gl.uniform3f(gl.getUniformLocation(prog, "uColor"), rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(gl.getUniformLocation(prog, "uSelected"), isSel);
        const geom = meshes.orbits[b.id];
        bindAttr(gl, prog, "position", geom.position, 3);
        bindAttr(gl, prog, "aAngle", geom.aAngle, 1);
        bindAttr(gl, prog, "aAcross", geom.aAcross, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geom.index);
        gl.drawElements(gl.TRIANGLES, geom.count, gl.UNSIGNED_SHORT, 0);
      });
    }

    // 4. Sol (superficie convectiva opaca)
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    {
      const prog = programs.sun;
      gl.useProgram(prog);
      const model = mat4Compose([0, 0, 0], 0, elapsed * 0.04, 0, 2.2);
      const mv = mat4Multiply(view, model);
      const nMat = mat3FromMat4(mv);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, mv);
      gl.uniformMatrix3fv(gl.getUniformLocation(prog, "normalMatrix"), false, nMat);
      gl.uniform1f(gl.getUniformLocation(prog, "uTime"), elapsed);
      bindAttr(gl, prog, "position", meshes.unitSphere.position, 3);
      bindAttr(gl, prog, "normal", meshes.unitSphere.normal, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.unitSphere.index);
      gl.drawElements(gl.TRIANGLES, meshes.unitSphere.count, gl.UNSIGNED_SHORT, 0);
    }

    // 5A. Planetas y lunas (esferas opacas)
    {
      const prog = programs.planet;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "viewMatrix"), false, view);
      gl.uniform3f(gl.getUniformLocation(prog, "cameraPosition"), state.camPos[0], state.camPos[1], state.camPos[2]);
      gl.uniform1f(gl.getUniformLocation(prog, "uTime"), elapsed);

      bindAttr(gl, prog, "position", meshes.unitSphere.position, 3);
      bindAttr(gl, prog, "normal", meshes.unitSphere.normal, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.unitSphere.index);

      SOLAR_BODIES.forEach((b) => {
        if (b.uType === 3) return; // Estación, Rover y Nave se renderizan con su geometría 3D propia
        const pos = state.worldPositions[b.id] || [0, 0, 0];
        const rotY = b.seed * Math.PI * 2 + elapsed * b.rotationSpeed * 0.6;
        const model = mat4Compose(pos, 0, rotY, 0, b.size);
        const rgb = hexToRgb(b.color);
        const isFocus = (b.envKey && b.envKey === state.envKey) || state.hoveredId === b.id;
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelMatrix"), false, model);
        gl.uniform3f(gl.getUniformLocation(prog, "uColor"), rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(gl.getUniformLocation(prog, "uSeed"), b.seed);
        gl.uniform1f(gl.getUniformLocation(prog, "uType"), b.uType);
        gl.uniform1f(gl.getUniformLocation(prog, "uHover"), isFocus ? 1.0 : 0.15);
        gl.uniform1f(gl.getUniformLocation(prog, "uActivity"), 0.9);
        gl.drawElements(gl.TRIANGLES, meshes.unitSphere.count, gl.UNSIGNED_SHORT, 0);
      });
    }

    // 5B. Modelos 3D dedicados para Estación Espacial (ISS), Rover Presurizado y Nave Espacial (Orion)
    {
      const prog = programs.craft;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "viewMatrix"), false, view);
      gl.uniform3f(gl.getUniformLocation(prog, "cameraPosition"), state.camPos[0], state.camPos[1], state.camPos[2]);
      gl.uniform1f(gl.getUniformLocation(prog, "uTime"), elapsed);

      SOLAR_BODIES.forEach((b) => {
        if (b.uType !== 3) return;
        const craftMesh = meshes[b.id] || meshes.spacecraft;
        const pos = state.worldPositions[b.id] || [0, 0, 0];
        const isFocus = (b.envKey && b.envKey === state.envKey) || state.hoveredId === b.id;
        const rotY = b.seed * Math.PI * 2 + elapsed * b.rotationSpeed * 0.45;
        const rotX = b.id === "station" ? 0.22 : b.id === "rover" ? 0.08 : 0.16;
        const craftScale = b.size * (isFocus ? 1.45 : 1.15);
        const model = mat4Compose(pos, rotX, rotY, 0, craftScale);
        const rgb = hexToRgb(b.color);

        bindAttr(gl, prog, "position", craftMesh.position, 3);
        bindAttr(gl, prog, "normal", craftMesh.normal, 3);
        bindAttr(gl, prog, "aPart", craftMesh.aPart, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, craftMesh.index);

        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelMatrix"), false, model);
        gl.uniform3f(gl.getUniformLocation(prog, "uColor"), rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(gl.getUniformLocation(prog, "uHover"), isFocus ? 1.0 : 0.2);
        gl.drawElements(gl.TRIANGLES, craftMesh.count, gl.UNSIGNED_SHORT, 0);
      });
    }

    // 6. Capas transparentes: corona solar, brasas, nubes, anillos y halos atmosféricos Fresnel
    gl.depthMask(false);
    gl.enable(gl.BLEND);

    // Corona solar (BackSide + aditivo)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    {
      const prog = programs.corona;
      gl.useProgram(prog);
      const model = mat4Compose([0, 0, 0], 0, 0, 0, 2.2 * 1.42);
      const mv = mat4Multiply(view, model);
      const nMat = mat3FromMat4(mv);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, mv);
      gl.uniformMatrix3fv(gl.getUniformLocation(prog, "normalMatrix"), false, nMat);
      gl.uniform1f(gl.getUniformLocation(prog, "uTime"), elapsed);
      bindAttr(gl, prog, "position", meshes.unitSphere.position, 3);
      bindAttr(gl, prog, "normal", meshes.unitSphere.normal, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.unitSphere.index);
      gl.drawElements(gl.TRIANGLES, meshes.unitSphere.count, gl.UNSIGNED_SHORT, 0);
    }

    // Halos atmosféricos Fresnel (D4, BackSide + aditivo; solo planetas y lunas esféricos)
    {
      const prog = programs.atmo;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "viewMatrix"), false, view);
      gl.uniform3f(gl.getUniformLocation(prog, "cameraPosition"), state.camPos[0], state.camPos[1], state.camPos[2]);
      bindAttr(gl, prog, "position", meshes.unitSphere.position, 3);
      bindAttr(gl, prog, "normal", meshes.unitSphere.normal, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.unitSphere.index);

      SOLAR_BODIES.forEach((b) => {
        if (!b.atmosphere || b.uType === 3) return;
        const pos = state.worldPositions[b.id] || [0, 0, 0];
        const isSel = b.envKey && b.envKey === state.envKey;
        const scale = b.size * (isSel ? 1.24 : 1.14);
        const model = mat4Compose(pos, 0, 0, 0, scale);
        const rgb = hexToRgb(b.color);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelMatrix"), false, model);
        gl.uniform3f(gl.getUniformLocation(prog, "uColor"), rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(gl.getUniformLocation(prog, "uIntensity"), isSel ? 0.72 : 0.42);
        gl.uniform1f(gl.getUniformLocation(prog, "uHover"), isSel ? 1.0 : 0.0);
        gl.drawElements(gl.TRIANGLES, meshes.unitSphere.count, gl.UNSIGNED_SHORT, 0);
      });
    }
    gl.disable(gl.CULL_FACE);

    // Brasas solares (M4 / w4)
    {
      const prog = programs.embers;
      gl.useProgram(prog);
      const model = mat4Compose([0, 0, 0], 0, elapsed * 0.03, 0, 1);
      const mv = mat4Multiply(view, model);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, mv);
      gl.uniform1f(gl.getUniformLocation(prog, "uTime"), elapsed);
      gl.uniform1f(gl.getUniformLocation(prog, "uPixelRatio"), dpr);
      bindAttr(gl, prog, "position", meshes.embers.position, 3);
      bindAttr(gl, prog, "aPhase", meshes.embers.aPhase, 1);
      bindAttr(gl, prog, "aSpeed", meshes.embers.aSpeed, 1);
      bindAttr(gl, prog, "aSize", meshes.embers.aSize, 1);
      gl.drawArrays(gl.POINTS, 0, meshes.embers.count);
    }

    // Nubes terrestres y anillos de Saturno (mezcla alfa normal)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    {
      const prog = programs.cloud;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "viewMatrix"), false, view);
      bindAttr(gl, prog, "position", meshes.unitSphere.position, 3);
      bindAttr(gl, prog, "normal", meshes.unitSphere.normal, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.unitSphere.index);
      SOLAR_BODIES.forEach((b) => {
        if (!b.clouds) return;
        const pos = state.worldPositions[b.id] || [0, 0, 0];
        const model = mat4Compose(pos, 0, elapsed * 0.5, 0, b.size * 1.04);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelMatrix"), false, model);
        gl.uniform1f(gl.getUniformLocation(prog, "uSeed"), b.seed);
        gl.drawElements(gl.TRIANGLES, meshes.unitSphere.count, gl.UNSIGNED_SHORT, 0);
      });
    }

    // Anillos de Saturno (O4 / z4)
    {
      const saturn = SOLAR_BODIES.find((b) => b.id === "saturn");
      if (saturn) {
        const prog = programs.ring;
        gl.useProgram(prog);
        const pos = state.worldPositions.saturn || [0, 0, 0];
        const model = mat4Compose(pos, -Math.PI / 2 + 0.42, 0, 0.15, 1);
        const mv = mat4Multiply(view, model);
        const rgb = hexToRgb(saturn.color);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "projectionMatrix"), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, "modelViewMatrix"), false, mv);
        gl.uniform1f(gl.getUniformLocation(prog, "uInner"), 1.45 * saturn.size);
        gl.uniform1f(gl.getUniformLocation(prog, "uOuter"), 2.45 * saturn.size);
        gl.uniform3f(gl.getUniformLocation(prog, "uColor"), rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(gl.getUniformLocation(prog, "uSeed"), saturn.seed);
        bindAttr(gl, prog, "position", meshes.saturnRing.position, 3);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.saturnRing.index);
        gl.drawElements(gl.TRIANGLES, meshes.saturnRing.count, gl.UNSIGNED_SHORT, 0);
      }
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // 7. Proyección 2D de pines de entorno sobre el lienzo
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    SOLAR_BODIES.forEach((b) => {
      const pos = state.worldPositions[b.id];
      if (!pos) return;
      const proj2d = projectToScreen(pos, viewProj, cssW, cssH);
      state.screenProjections[b.id] = proj2d;
      const pin = markerNodes[b.id];
      if (!pin) return;
      if (!proj2d || proj2d.x < -20 || proj2d.x > cssW + 20 || proj2d.y < -20 || proj2d.y > cssH + 20) {
        pin.style.opacity = "0";
        pin.style.pointerEvents = "none";
      } else {
        pin.style.opacity = "1";
        pin.style.pointerEvents = "auto";
        pin.style.transform = `translate3d(${proj2d.x.toFixed(1)}px, ${proj2d.y.toFixed(1)}px, 0)`;
      }
    });

    state.rafId = requestAnimationFrame(renderFrame);
  }

  function setEnvironment(envKey) {
    if (!envKey) return;
    const changed = state.envKey !== envKey;
    state.envKey = envKey;
    state.overview = false;
    if (changed) {
      state.zoomScale = 1.0;
      startCameraTransition();
    }
    syncModeButtons();
    renderHudText();
  }

  renderHudText();
  state.rafId = requestAnimationFrame(renderFrame);

  return {
    setEnvironment,
    refreshLabels: renderHudText,
    destroy() {
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = null;
    },
  };
}
