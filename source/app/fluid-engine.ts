/**
 * A compact WebGL2 stable-fluid solver tailored to suminagashi / wet ink.
 *
 * Public coordinates are normalised CSS-canvas coordinates: (0, 0) is the
 * top-left and (1, 1) is the bottom-right. Colours are linear-ish RGB values
 * in the familiar 0..1 range.
 */

export type InkColor = [number, number, number];

export type FluidStepOptions = {
  /** Overall transport speed. 1 is natural, 0 pauses advection. */
  flow: number;
  /** Wet spread / pigment diffusion in the 0..1 range. */
  diffusion: number;
};

type GL = WebGL2RenderingContext;

type TextureFormat = {
  internalFormat: number;
  format: number;
};

type Framebuffer = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  texelX: number;
  texelY: number;
};

type DoubleFramebuffer = {
  read: Framebuffer;
  write: Framebuffer;
  swap: () => void;
};

type ShaderProgram = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

type ProgramSet = {
  copy: ShaderProgram;
  multiply: ShaderProgram;
  splat: ShaderProgram;
  additiveSplat: ShaderProgram;
  curl: ShaderProgram;
  vorticity: ShaderProgram;
  divergence: ShaderProgram;
  pressure: ShaderProgram;
  gradient: ShaderProgram;
  advection: ShaderProgram;
  pigmentDetail: ShaderProgram;
  disperseVelocity: ShaderProgram;
  dispersePigment: ShaderProgram;
  render: ShaderProgram;
};

type FormatSet = {
  scalar: TextureFormat;
  velocity: TextureFormat;
  pigment: TextureFormat;
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUv;

void main () {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  // p uses the classic oversized full-screen triangle coordinates (0 or 2).
  // After clipping, interpolated values across the viewport are exactly 0..1.
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
`;

const COPY_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uTexture;
void main () { outColor = texture(uTexture, vUv); }
`;

const MULTIPLY_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uTexture;
uniform float uValue;
void main () { outColor = texture(uTexture, vUv) * uValue; }
`;

const SPLAT_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform vec4 uValue;
uniform float uSeed;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345 + uSeed);
  return fract(p.x * p.y);
}

void main () {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float rr = max(uRadius * uRadius, 1e-7);
  float d2 = dot(p, p);
  float softBody = exp(-d2 / rr * 3.35);
  float edgeBreakup = mix(0.91, 1.08, hash21(floor(vUv * 920.0)));
  float fibre = 0.96 + 0.04 * sin((p.x + p.y) * 1150.0 + uSeed * 9.0);
  float shape = softBody * edgeBreakup * fibre;
  outColor = texture(uTarget, vUv) + uValue * shape;
}
`;

const ADDITIVE_SPLAT_SHADER = `${FRAGMENT_HEADER}
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform vec4 uValue;
uniform float uSeed;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345 + uSeed);
  return fract(p.x * p.y);
}

void main () {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float rr = max(uRadius * uRadius, 1e-7);
  float d2 = dot(p, p);
  float softBody = exp(-d2 / rr * 3.35);
  float edgeBreakup = mix(0.91, 1.08, hash21(floor(vUv * 920.0)));
  float fibre = 0.96 + 0.04 * sin((p.x + p.y) * 1150.0 + uSeed * 9.0);
  outColor = uValue * softBody * edgeBreakup * fibre;
}
`;

const CURL_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main () {
  float l = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
  float r = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
  float b = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
  float t = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
  outColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
}
`;

const VORTICITY_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uStrength;

void main () {
  float l = abs(texture(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x);
  float r = abs(texture(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x);
  float b = abs(texture(uCurl, vUv - vec2(0.0, uTexelSize.y)).x);
  float t = abs(texture(uCurl, vUv + vec2(0.0, uTexelSize.y)).x);
  float c = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(t - b, r - l);
  force /= length(force) + 0.0001;
  force *= uStrength * c;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy + force * uDt;
  float speed = length(velocity);
  velocity *= min(1.0, 3.5 / max(speed, 0.0001));
  outColor = vec4(velocity, 0.0, 1.0);
}
`;

const DIVERGENCE_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main () {
  vec2 c = texture(uVelocity, vUv).xy;
  float l = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
  float r = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
  float b = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
  float t = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;

  if (vUv.x < uTexelSize.x) l = -c.x;
  if (vUv.x > 1.0 - uTexelSize.x) r = -c.x;
  if (vUv.y < uTexelSize.y) b = -c.y;
  if (vUv.y > 1.0 - uTexelSize.y) t = -c.y;

  outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}
`;

const PRESSURE_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;

void main () {
  float l = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  float d = texture(uDivergence, vUv).x;
  outColor = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}
`;

const GRADIENT_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main () {
  float l = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  vec2 velocity = texture(uVelocity, vUv).xy - 0.5 * vec2(r - l, t - b);

  if (vUv.x < uTexelSize.x || vUv.x > 1.0 - uTexelSize.x) velocity.x = 0.0;
  if (vUv.y < uTexelSize.y || vUv.y > 1.0 - uTexelSize.y) velocity.y = 0.0;
  outColor = vec4(velocity, 0.0, 1.0);
}
`;

const ADVECTION_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelocityTexelSize;
uniform vec2 uSourceTexelSize;
uniform float uDt;
uniform float uDissipation;

vec4 bilerp(sampler2D tex, vec2 uv, vec2 texelSize) {
  uv = clamp(uv, texelSize * 0.5, vec2(1.0) - texelSize * 0.5);
  vec2 st = uv / texelSize - 0.5;
  vec2 i = floor(st);
  vec2 f = fract(st);
  vec2 a = (i + 0.5) * texelSize;
  vec4 c00 = texture(tex, a);
  vec4 c10 = texture(tex, a + vec2(texelSize.x, 0.0));
  vec4 c01 = texture(tex, a + vec2(0.0, texelSize.y));
  vec4 c11 = texture(tex, a + texelSize);
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

void main () {
  vec2 velocity = bilerp(uVelocity, vUv, uVelocityTexelSize).xy;
  vec2 previous = vUv - uDt * velocity;
  outColor = bilerp(uSource, previous, uSourceTexelSize) * uDissipation;
}
`;

const PIGMENT_DETAIL_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uPigment;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uDiffusion;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main () {
  vec4 c = texture(uPigment, vUv);
  vec4 l = texture(uPigment, vUv - vec2(uTexelSize.x, 0.0));
  vec4 r = texture(uPigment, vUv + vec2(uTexelSize.x, 0.0));
  vec4 b = texture(uPigment, vUv - vec2(0.0, uTexelSize.y));
  vec4 t = texture(uPigment, vUv + vec2(0.0, uTexelSize.y));
  vec4 average = (l + r + b + t) * 0.25;

  // Diffusion is a convex mix: it can spread existing pigment but cannot
  // create pigment.  The following multiplier is always below one, so wet ink
  // steadily dilutes instead of developing artificial dark deposits.
  float spread = clamp(uDiffusion * uDt * 8.0, 0.0, 0.34);
  vec4 pigment = mix(c, average, spread);
  float grain = hash21(floor(vUv / uTexelSize * 0.72) + vec2(17.0, 43.0));
  float dilutionRate = 0.038 + uDiffusion * 0.045 + grain * 0.017;
  pigment = max(vec4(0.0), pigment * exp(-uDt * dilutionRate));
  pigment.rgb = min(pigment.rgb, vec3(pigment.a));
  outColor = pigment;
}
`;

const DISPERSE_VELOCITY_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uVelocity;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform float uStrength;
uniform float uForce;

void main () {
  vec2 delta = vUv - uPoint;
  vec2 physical = vec2(delta.x * uAspect, delta.y);
  float distanceToPoint = length(physical);
  vec2 direction = physical / max(distanceToPoint, 0.0001);
  vec2 uvDirection = vec2(direction.x / uAspect, direction.y);
  float centreGate = smoothstep(0.0, uRadius * 0.11, distanceToPoint);
  float falloff = exp(-pow(distanceToPoint / max(uRadius, 0.0001), 2.0) * 1.45);
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity += uvDirection * uForce * uStrength * falloff * centreGate;
  outColor = vec4(velocity, 0.0, 1.0);
}
`;

const DISPERSE_PIGMENT_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uPigment;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform float uStrength;

void main () {
  vec2 delta = vUv - uPoint;
  vec2 physical = vec2(delta.x * uAspect, delta.y);
  float distanceToPoint = length(physical);
  float core = 1.0 - smoothstep(uRadius * 0.18, uRadius * 0.88, distanceToPoint);
  vec4 existing = texture(uPigment, vUv);
  outColor = existing * (1.0 - core * clamp(uStrength, 0.0, 1.0) * 0.94);
}
`;

const RENDER_SHADER = `${FRAGMENT_HEADER}
uniform sampler2D uPigment;
uniform vec2 uTexelSize;
uniform vec2 uResolution;
uniform float uManualFilter;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
}

vec4 pigmentSample(vec2 uv) {
  if (uManualFilter < 0.5) return texture(uPigment, uv);
  uv = clamp(uv, uTexelSize * 0.5, vec2(1.0) - uTexelSize * 0.5);
  vec2 st = uv / uTexelSize - 0.5;
  vec2 i = floor(st);
  vec2 f = fract(st);
  vec2 a = (i + 0.5) * uTexelSize;
  vec4 c00 = texture(uPigment, a);
  vec4 c10 = texture(uPigment, a + vec2(uTexelSize.x, 0.0));
  vec4 c01 = texture(uPigment, a + vec2(0.0, uTexelSize.y));
  vec4 c11 = texture(uPigment, a + uTexelSize);
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

vec3 linearToSrgb(vec3 colour) {
  vec3 low = colour * 12.92;
  vec3 high = 1.055 * pow(max(colour, 0.0), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), colour));
}

void main () {
  vec4 pigment = pigmentSample(vUv);

  vec2 pixel = vUv * uResolution;
  float broadPaper = valueNoise(pixel * 0.012) - 0.5;
  float finePaper = hash21(floor(pixel * 0.78)) - 0.5;
  float fibres = sin(pixel.x * 0.061 + valueNoise(pixel * 0.018) * 7.0) * 0.5 + 0.5;
  vec3 paper = vec3(0.865, 0.812, 0.701);
  paper += broadPaper * vec3(0.030, 0.026, 0.018);
  paper += finePaper * 0.012 + (fibres - 0.5) * vec3(0.008, 0.007, 0.004);

  float granulation = 0.92 + 0.07 * valueNoise(pixel * 0.10);
  float density = max(0.0, pigment.a * granulation);
  float coverage = clamp(1.0 - exp(-density * 1.32), 0.0, 0.985);
  vec3 inkColour = pigment.rgb / max(pigment.a, 0.0001);
  inkColour = clamp(inkColour, 0.0, 1.0);
  vec3 soakedInk = mix(inkColour, inkColour * paper, 0.34);
  vec3 colour = mix(paper, soakedInk, coverage);

  outColor = vec4(linearToSrgb(clamp(colour, 0.0, 1.0)), 1.0);
}
`;

const PROGRAM_UNIFORMS: Record<keyof ProgramSet, string[]> = {
  copy: ["uTexture"],
  multiply: ["uTexture", "uValue"],
  splat: ["uTarget", "uPoint", "uRadius", "uAspect", "uValue", "uSeed"],
  additiveSplat: ["uPoint", "uRadius", "uAspect", "uValue", "uSeed"],
  curl: ["uVelocity", "uTexelSize"],
  vorticity: ["uVelocity", "uCurl", "uTexelSize", "uDt", "uStrength"],
  divergence: ["uVelocity", "uTexelSize"],
  pressure: ["uPressure", "uDivergence", "uTexelSize"],
  gradient: ["uPressure", "uVelocity", "uTexelSize"],
  advection: [
    "uVelocity",
    "uSource",
    "uVelocityTexelSize",
    "uSourceTexelSize",
    "uDt",
    "uDissipation",
  ],
  pigmentDetail: ["uPigment", "uTexelSize", "uDt", "uDiffusion"],
  disperseVelocity: ["uVelocity", "uPoint", "uRadius", "uAspect", "uStrength", "uForce"],
  dispersePigment: ["uPigment", "uPoint", "uRadius", "uAspect", "uStrength"],
  render: ["uPigment", "uTexelSize", "uResolution", "uManualFilter"],
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));

/** GPU stable-fluid simulation and paper/ink renderer for a full-screen canvas. */
export class FluidEngine {
  readonly supported: boolean;

  private readonly canvas: HTMLCanvasElement;
  private readonly gl: GL | null;
  private fallback2d: CanvasRenderingContext2D | null = null;
  private programs: ProgramSet | null = null;
  private formats: FormatSet | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private velocity: DoubleFramebuffer | null = null;
  private pressure: DoubleFramebuffer | null = null;
  private pigment: DoubleFramebuffer | null = null;
  private divergence: Framebuffer | null = null;
  private curl: Framebuffer | null = null;

  private destroyed = false;
  private contextLost = false;
  private time = 0;
  private splatSerial = 1;
  private floatBlendSupported = false;
  private linearFilteringSupported = false;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };

  private readonly onContextRestored = (): void => {
    if (this.destroyed || !this.gl) return;
    this.contextLost = false;
    this.programs = null;
    this.formats = null;
    this.vao = null;
    this.velocity = null;
    this.pressure = null;
    this.pigment = null;
    this.divergence = null;
    this.curl = null;

    try {
      this.initialiseGL();
      this.resize(true);
      this.clear();
    } catch {
      this.contextLost = true;
    }
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const attributes: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    };

    this.gl = canvas.getContext("webgl2", attributes);
    let available = false;

    if (this.gl) {
      try {
        this.initialiseGL();
        available = true;
      } catch {
        this.disposeGLResources();
      }
      canvas.addEventListener("webglcontextlost", this.onContextLost, false);
      canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);
    } else {
      this.fallback2d = canvas.getContext("2d");
    }

    this.supported = available;
    try {
      this.resize(true);
      this.clear();
    } catch (error) {
      canvas.removeEventListener("webglcontextlost", this.onContextLost, false);
      canvas.removeEventListener("webglcontextrestored", this.onContextRestored, false);
      this.disposeGLResources();
      throw error;
    }
  }

  /** Match the drawing buffer to CSS size and rebuild simulation buffers. */
  resize(force = false): void {
    if (this.destroyed) return;

    const hasLayoutSize = this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0;
    const cssWidth = Math.max(1, hasLayoutSize ? this.canvas.clientWidth : this.canvas.width || 1);
    const cssHeight = Math.max(1, hasLayoutSize ? this.canvas.clientHeight : this.canvas.height || 1);
    const dpr = hasLayoutSize && typeof window !== "undefined" ? clamp(window.devicePixelRatio, 1, 2) : 1;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    const canvasChanged = width !== this.canvas.width || height !== this.canvas.height;

    if (canvasChanged) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    if (!this.supported || !this.gl || !this.programs || !this.formats || this.contextLost) {
      if (this.fallback2d && (canvasChanged || force)) this.clearFallback();
      if (this.gl && !this.supported) this.clearUnsupportedGL();
      return;
    }

    const simBase = Math.min(270, Math.max(128, Math.round(Math.min(width, height) * 0.34)));
    const dyeBase = Math.min(720, Math.max(360, Math.round(Math.min(width, height) * 0.78)));
    const simSize = this.resolutionFor(simBase, width / height, 310_000);
    const dyeSize = this.resolutionFor(dyeBase, width / height, 1_250_000);
    const sizeChanged =
      !this.velocity ||
      !this.pigment ||
      this.velocity.read.width !== simSize.width ||
      this.velocity.read.height !== simSize.height ||
      this.pigment.read.width !== dyeSize.width ||
      this.pigment.read.height !== dyeSize.height;

    if (!force && !sizeChanged) {
      if (canvasChanged) this.render();
      return;
    }

    const oldVelocity = this.velocity;
    const oldPressure = this.pressure;
    const oldPigment = this.pigment;
    const oldDivergence = this.divergence;
    const oldCurl = this.curl;

    let nextVelocity: DoubleFramebuffer | null = null;
    let nextPressure: DoubleFramebuffer | null = null;
    let nextDivergence: Framebuffer | null = null;
    let nextCurl: Framebuffer | null = null;
    let nextPigment: DoubleFramebuffer | null = null;
    try {
      nextVelocity = this.createDoubleFramebuffer(
        simSize.width,
        simSize.height,
        this.formats.velocity,
      );
      nextPressure = this.createDoubleFramebuffer(
        simSize.width,
        simSize.height,
        this.formats.scalar,
      );
      nextDivergence = this.createFramebuffer(simSize.width, simSize.height, this.formats.scalar);
      nextCurl = this.createFramebuffer(simSize.width, simSize.height, this.formats.scalar);
      nextPigment = this.createDoubleFramebuffer(
        dyeSize.width,
        dyeSize.height,
        this.formats.pigment,
        this.linearFilteringSupported,
      );
    } catch (error) {
      this.deleteDoubleFramebuffer(nextVelocity);
      this.deleteDoubleFramebuffer(nextPressure);
      this.deleteDoubleFramebuffer(nextPigment);
      this.deleteFramebuffer(nextDivergence);
      this.deleteFramebuffer(nextCurl);
      if (!oldVelocity || !oldPigment) throw error;
      return;
    }

    this.velocity = nextVelocity;
    this.pressure = nextPressure;
    this.divergence = nextDivergence;
    this.curl = nextCurl;
    this.pigment = nextPigment;

    if (oldVelocity && oldPigment) {
      this.copyTexture(oldVelocity.read.texture, this.velocity.read);
      this.copyTexture(this.velocity.read.texture, this.velocity.write);
      this.copyTexture(oldPigment.read.texture, this.pigment.read);
      this.copyTexture(this.pigment.read.texture, this.pigment.write);
    }

    this.deleteDoubleFramebuffer(oldVelocity);
    this.deleteDoubleFramebuffer(oldPressure);
    this.deleteDoubleFramebuffer(oldPigment);
    this.deleteFramebuffer(oldDivergence);
    this.deleteFramebuffer(oldCurl);
    this.render();
  }

  /** Advance velocity, pressure and pigment, then render the current frame. */
  step(dt: number, options: FluidStepOptions): void {
    if (this.destroyed) return;
    if (!this.supported || !this.ready()) return;

    this.resize();
    if (!this.ready()) return;

    const gl = this.gl!;
    const programs = this.programs!;
    const velocity = this.velocity!;
    const pressure = this.pressure!;
    const pigment = this.pigment!;
    const divergence = this.divergence!;
    const curl = this.curl!;
    const rawSeconds = dt > 1 ? dt / 1000 : dt;
    if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) {
      this.render();
      return;
    }
    const seconds = clamp(rawSeconds, 0.0001, 1 / 30);
    const flow = clamp(options?.flow ?? 1, 0, 2.5);
    const diffusion = clamp(options?.diffusion ?? 0.35, 0, 1);
    this.time += seconds;

    gl.disable(gl.BLEND);
    this.bindTarget(curl);
    this.use(programs.curl);
    this.bindTexture(velocity.read.texture, 0, programs.curl.uniforms.uVelocity);
    gl.uniform2f(programs.curl.uniforms.uTexelSize, velocity.read.texelX, velocity.read.texelY);
    this.draw();

    this.bindTarget(velocity.write);
    this.use(programs.vorticity);
    this.bindTexture(velocity.read.texture, 0, programs.vorticity.uniforms.uVelocity);
    this.bindTexture(curl.texture, 1, programs.vorticity.uniforms.uCurl);
    gl.uniform2f(programs.vorticity.uniforms.uTexelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform1f(programs.vorticity.uniforms.uDt, seconds);
    gl.uniform1f(programs.vorticity.uniforms.uStrength, 10 + flow * 15);
    this.draw();
    velocity.swap();

    this.bindTarget(divergence);
    this.use(programs.divergence);
    this.bindTexture(velocity.read.texture, 0, programs.divergence.uniforms.uVelocity);
    gl.uniform2f(programs.divergence.uniforms.uTexelSize, velocity.read.texelX, velocity.read.texelY);
    this.draw();

    this.bindTarget(pressure.write);
    this.use(programs.multiply);
    this.bindTexture(pressure.read.texture, 0, programs.multiply.uniforms.uTexture);
    gl.uniform1f(programs.multiply.uniforms.uValue, 0.78);
    this.draw();
    pressure.swap();

    this.use(programs.pressure);
    gl.uniform2f(programs.pressure.uniforms.uTexelSize, pressure.read.texelX, pressure.read.texelY);
    this.bindTexture(divergence.texture, 1, programs.pressure.uniforms.uDivergence);
    for (let iteration = 0; iteration < 17; iteration += 1) {
      this.bindTarget(pressure.write);
      this.bindTexture(pressure.read.texture, 0, programs.pressure.uniforms.uPressure);
      this.draw();
      pressure.swap();
    }

    this.bindTarget(velocity.write);
    this.use(programs.gradient);
    this.bindTexture(pressure.read.texture, 0, programs.gradient.uniforms.uPressure);
    this.bindTexture(velocity.read.texture, 1, programs.gradient.uniforms.uVelocity);
    gl.uniform2f(programs.gradient.uniforms.uTexelSize, velocity.read.texelX, velocity.read.texelY);
    this.draw();
    velocity.swap();

    this.bindTarget(velocity.write);
    this.use(programs.advection);
    this.bindTexture(velocity.read.texture, 0, programs.advection.uniforms.uVelocity);
    this.bindTexture(velocity.read.texture, 1, programs.advection.uniforms.uSource);
    gl.uniform2f(
      programs.advection.uniforms.uVelocityTexelSize,
      velocity.read.texelX,
      velocity.read.texelY,
    );
    gl.uniform2f(programs.advection.uniforms.uSourceTexelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform1f(programs.advection.uniforms.uDt, seconds * flow);
    gl.uniform1f(programs.advection.uniforms.uDissipation, Math.exp(-seconds * (0.075 + flow * 0.02)));
    this.draw();
    velocity.swap();

    this.bindTarget(pigment.write);
    this.use(programs.advection);
    this.bindTexture(velocity.read.texture, 0, programs.advection.uniforms.uVelocity);
    this.bindTexture(pigment.read.texture, 1, programs.advection.uniforms.uSource);
    gl.uniform2f(
      programs.advection.uniforms.uVelocityTexelSize,
      velocity.read.texelX,
      velocity.read.texelY,
    );
    gl.uniform2f(programs.advection.uniforms.uSourceTexelSize, pigment.read.texelX, pigment.read.texelY);
    gl.uniform1f(programs.advection.uniforms.uDt, seconds * flow);
    gl.uniform1f(programs.advection.uniforms.uDissipation, Math.exp(-seconds * 0.008));
    this.draw();
    pigment.swap();

    this.bindTarget(pigment.write);
    this.use(programs.pigmentDetail);
    this.bindTexture(pigment.read.texture, 0, programs.pigmentDetail.uniforms.uPigment);
    gl.uniform2f(programs.pigmentDetail.uniforms.uTexelSize, pigment.read.texelX, pigment.read.texelY);
    gl.uniform1f(programs.pigmentDetail.uniforms.uDt, seconds);
    gl.uniform1f(programs.pigmentDetail.uniforms.uDiffusion, diffusion);
    this.draw();
    pigment.swap();

    this.render();
  }

  /**
   * Add a hand-made ink stroke. dx/dy are normalised pointer deltas; radius is
   * measured against the canvas' shorter dimension and amount is ink load.
   */
  splat(
    x: number,
    y: number,
    dx: number,
    dy: number,
    color: InkColor,
    radius: number,
    amount: number,
  ): void {
    if (this.destroyed) return;
    if (!this.supported || !this.ready()) {
      this.fallbackSplat(x, y, color, radius, amount);
      return;
    }

    const velocity = this.velocity!;
    const pigment = this.pigment!;
    const px = clamp(x, 0, 1);
    const py = 1 - clamp(y, 0, 1);
    const r = clamp(radius, 0.0015, 0.35);
    const load = clamp(amount, 0.005, 4);
    const serial = this.splatSerial++;
    const vx = clamp(dx, -0.25, 0.25) * 28 * Math.min(1.6, load + 0.25);
    const vy = -clamp(dy, -0.25, 0.25) * 28 * Math.min(1.6, load + 0.25);

    this.applySplat(velocity, px, py, r * 1.15, [vx, vy, 0, 0], serial * 0.77);

    const red = clamp(color?.[0] ?? 0, 0, 1);
    const green = clamp(color?.[1] ?? 0, 0, 1);
    const blue = clamp(color?.[2] ?? 0, 0, 1);
    const layers = [
      { radius: r * 1.82, amount: load * 0.10, offset: -0.035 },
      { radius: r, amount: load * 0.35, offset: 0.018 },
      { radius: r * 0.52, amount: load * 0.67, offset: -0.012 },
    ];

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const angle = serial * 2.399 + index * 2.094;
      const jitter = r * layer.offset;
      const layerX = clamp(px + (Math.cos(angle) * jitter) / (pigment.read.width / pigment.read.height), 0, 1);
      const layerY = clamp(py + Math.sin(angle) * jitter, 0, 1);
      const alpha = layer.amount;
      this.applySplat(
        pigment,
        layerX,
        layerY,
        layer.radius,
        [red * alpha, green * alpha, blue * alpha, alpha],
        serial + index * 1.37,
      );
    }
  }

  /**
   * Push the water without adding pigment. dx/dy are pointer velocity in
   * normalised canvas units per second; faster motion produces a stronger
   * current while strength remains a user-input gain.
   */
  stir(
    x: number,
    y: number,
    dx: number,
    dy: number,
    radius: number,
    strength = 1,
  ): void {
    if (this.destroyed || !this.supported || !this.ready()) return;
    const velocity = this.velocity!;
    const power = clamp(strength, 0, 1.8);
    const pointerSpeed = Math.hypot(dx, dy);
    const velocityScale = Math.min(1, 3 / Math.max(pointerSpeed, 0.0001));
    const vx = dx * velocityScale * 0.72 * power;
    const vy = -dy * velocityScale * 0.72 * power;
    if (Math.hypot(vx, vy) < 0.0001) return;

    this.applySplat(
      velocity,
      clamp(x, 0, 1),
      1 - clamp(y, 0, 1),
      clamp(radius, 0.008, 0.14),
      [vx, vy, 0, 0],
      this.splatSerial++ * 0.83,
    );
  }

  /** Inject surfactant: clear a soft centre and push surrounding pigment out. */
  disperse(x: number, y: number, radius: number, strength: number, force: number): void {
    if (this.destroyed || !this.supported || !this.ready()) return;
    const gl = this.gl!;
    const programs = this.programs!;
    const velocity = this.velocity!;
    const pigment = this.pigment!;
    const px = clamp(x, 0, 1);
    const py = 1 - clamp(y, 0, 1);
    const r = clamp(radius, 0.002, 0.38);
    const power = clamp(strength, 0, 1.5);
    const impulse = clamp(force, 0, 5);

    this.bindTarget(velocity.write);
    this.use(programs.disperseVelocity);
    this.bindTexture(velocity.read.texture, 0, programs.disperseVelocity.uniforms.uVelocity);
    gl.uniform2f(programs.disperseVelocity.uniforms.uPoint, px, py);
    gl.uniform1f(programs.disperseVelocity.uniforms.uRadius, r);
    gl.uniform1f(
      programs.disperseVelocity.uniforms.uAspect,
      velocity.read.width / velocity.read.height,
    );
    gl.uniform1f(programs.disperseVelocity.uniforms.uStrength, power);
    gl.uniform1f(programs.disperseVelocity.uniforms.uForce, impulse);
    this.draw();
    velocity.swap();

    this.bindTarget(pigment.write);
    this.use(programs.dispersePigment);
    this.bindTexture(pigment.read.texture, 0, programs.dispersePigment.uniforms.uPigment);
    gl.uniform2f(programs.dispersePigment.uniforms.uPoint, px, py);
    gl.uniform1f(programs.dispersePigment.uniforms.uRadius, r);
    gl.uniform1f(programs.dispersePigment.uniforms.uAspect, pigment.read.width / pigment.read.height);
    gl.uniform1f(programs.dispersePigment.uniforms.uStrength, power);
    this.draw();
    pigment.swap();
  }

  /** Remove all flow and pigment, leaving warm unmarked water/paper. */
  clear(): void {
    if (this.destroyed) return;
    this.time = 0;
    if (!this.supported || !this.gl || !this.ready()) {
      if (this.fallback2d) this.clearFallback();
      else if (this.gl) this.clearUnsupportedGL();
      return;
    }

    this.clearDouble(this.velocity);
    this.clearDouble(this.pressure);
    this.clearDouble(this.pigment);
    this.clearFramebuffer(this.divergence);
    this.clearFramebuffer(this.curl);
    this.render();
  }

  /** Render without advancing the solver (also useful while paused). */
  render(): void {
    if (this.destroyed || !this.supported || !this.ready()) return;
    const gl = this.gl!;
    const programs = this.programs!;
    const pigment = this.pigment!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    this.use(programs.render);
    this.bindTexture(pigment.read.texture, 0, programs.render.uniforms.uPigment);
    gl.uniform2f(programs.render.uniforms.uTexelSize, pigment.read.texelX, pigment.read.texelY);
    gl.uniform2f(programs.render.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(programs.render.uniforms.uManualFilter, this.linearFilteringSupported ? 0 : 1);
    this.draw();
  }

  /** Return the currently rendered canvas as a PNG data URL. */
  snapshot(): string | null {
    if (this.destroyed) return null;
    if (this.supported) this.render();
    try {
      return this.canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  /** Release GPU buffers, shaders and DOM event handlers. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost, false);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored, false);
    this.disposeGLResources();
    this.fallback2d = null;
  }

  private ready(): boolean {
    return Boolean(
      this.gl &&
        this.programs &&
        this.velocity &&
        this.pressure &&
        this.pigment &&
        this.divergence &&
        this.curl &&
        !this.contextLost,
    );
  }

  private initialiseGL(): void {
    const gl = this.gl;
    if (
      !gl ||
      (!gl.getExtension("EXT_color_buffer_float") &&
        !gl.getExtension("EXT_color_buffer_half_float"))
    ) {
      throw new Error("Renderable floating-point textures are unavailable.");
    }
    this.floatBlendSupported = Boolean(gl.getExtension("EXT_float_blend"));
    this.linearFilteringSupported = Boolean(
      gl.getExtension("OES_texture_float_linear") ||
        gl.getExtension("OES_texture_half_float_linear"),
    );

    const pigment = this.findRenderableFormat([
      { internalFormat: gl.RGBA16F, format: gl.RGBA },
    ]);
    const velocity = this.findRenderableFormat([
      { internalFormat: gl.RG16F, format: gl.RG },
      { internalFormat: gl.RGBA16F, format: gl.RGBA },
    ]);
    const scalar = this.findRenderableFormat([
      { internalFormat: gl.R16F, format: gl.RED },
      { internalFormat: gl.RG16F, format: gl.RG },
      { internalFormat: gl.RGBA16F, format: gl.RGBA },
    ]);

    if (!pigment || !velocity || !scalar) {
      throw new Error("No compatible floating-point framebuffer format was found.");
    }

    this.formats = { pigment, velocity, scalar };
    this.vao = gl.createVertexArray();
    if (!this.vao) throw new Error("Unable to create a vertex array.");
    gl.bindVertexArray(this.vao);

    this.programs = {
      copy: this.createProgram(COPY_SHADER, PROGRAM_UNIFORMS.copy),
      multiply: this.createProgram(MULTIPLY_SHADER, PROGRAM_UNIFORMS.multiply),
      splat: this.createProgram(SPLAT_SHADER, PROGRAM_UNIFORMS.splat),
      additiveSplat: this.createProgram(ADDITIVE_SPLAT_SHADER, PROGRAM_UNIFORMS.additiveSplat),
      curl: this.createProgram(CURL_SHADER, PROGRAM_UNIFORMS.curl),
      vorticity: this.createProgram(VORTICITY_SHADER, PROGRAM_UNIFORMS.vorticity),
      divergence: this.createProgram(DIVERGENCE_SHADER, PROGRAM_UNIFORMS.divergence),
      pressure: this.createProgram(PRESSURE_SHADER, PROGRAM_UNIFORMS.pressure),
      gradient: this.createProgram(GRADIENT_SHADER, PROGRAM_UNIFORMS.gradient),
      advection: this.createProgram(ADVECTION_SHADER, PROGRAM_UNIFORMS.advection),
      pigmentDetail: this.createProgram(PIGMENT_DETAIL_SHADER, PROGRAM_UNIFORMS.pigmentDetail),
      disperseVelocity: this.createProgram(
        DISPERSE_VELOCITY_SHADER,
        PROGRAM_UNIFORMS.disperseVelocity,
      ),
      dispersePigment: this.createProgram(
        DISPERSE_PIGMENT_SHADER,
        PROGRAM_UNIFORMS.dispersePigment,
      ),
      render: this.createProgram(RENDER_SHADER, PROGRAM_UNIFORMS.render),
    };
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to create a shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "Unknown shader compilation error.";
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  private createProgram(fragmentSource: string, uniformNames: string[]): ShaderProgram {
    const gl = this.gl!;
    const vertex = this.createShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      throw new Error("Unable to create a shader program.");
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "Unknown shader link error.";
      gl.deleteProgram(program);
      throw new Error(log);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }

  private findRenderableFormat(candidates: TextureFormat[]): TextureFormat | null {
    const gl = this.gl!;
    for (const candidate of candidates) {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) {
        if (texture) gl.deleteTexture(texture);
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
        continue;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        candidate.internalFormat,
        4,
        4,
        0,
        candidate.format,
        gl.HALF_FLOAT,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      if (complete) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return candidate;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return null;
  }

  private createFramebuffer(
    width: number,
    height: number,
    format: TextureFormat,
    linearFiltering = false,
  ): Framebuffer {
    const gl = this.gl!;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      throw new Error("Unable to allocate a simulation framebuffer.");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      linearFiltering ? gl.LINEAR : gl.NEAREST,
    );
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      linearFiltering ? gl.LINEAR : gl.NEAREST,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      format.internalFormat,
      width,
      height,
      0,
      format.format,
      gl.HALF_FLOAT,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      throw new Error("A simulation framebuffer is incomplete.");
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, width, height, texelX: 1 / width, texelY: 1 / height };
  }

  private createDoubleFramebuffer(
    width: number,
    height: number,
    format: TextureFormat,
    linearFiltering = false,
  ): DoubleFramebuffer {
    let read = this.createFramebuffer(width, height, format, linearFiltering);
    let write: Framebuffer;
    try {
      write = this.createFramebuffer(width, height, format, linearFiltering);
    } catch (error) {
      this.deleteFramebuffer(read);
      throw error;
    }
    return {
      get read() {
        return read;
      },
      set read(value: Framebuffer) {
        read = value;
      },
      get write() {
        return write;
      },
      set write(value: Framebuffer) {
        write = value;
      },
      swap() {
        const temporary = read;
        read = write;
        write = temporary;
      },
    };
  }

  private resolutionFor(
    shortSide: number,
    aspect: number,
    maximumPixels: number,
  ): { width: number; height: number } {
    let width = aspect >= 1 ? Math.round(shortSide * aspect) : shortSide;
    let height = aspect >= 1 ? shortSide : Math.round(shortSide / Math.max(aspect, 0.01));
    const pixels = width * height;
    if (pixels > maximumPixels) {
      const scale = Math.sqrt(maximumPixels / pixels);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    return { width, height };
  }

  private applySplat(
    target: DoubleFramebuffer,
    x: number,
    y: number,
    radius: number,
    value: [number, number, number, number],
    seed: number,
  ): void {
    const gl = this.gl!;
    if (this.floatBlendSupported) {
      const program = this.programs!.additiveSplat;
      this.bindTarget(target.read);
      this.use(program);
      gl.uniform2f(program.uniforms.uPoint, x, y);
      gl.uniform1f(program.uniforms.uRadius, radius);
      gl.uniform1f(program.uniforms.uAspect, target.read.width / target.read.height);
      gl.uniform4f(program.uniforms.uValue, value[0], value[1], value[2], value[3]);
      gl.uniform1f(program.uniforms.uSeed, seed);

      const pixelRadius = Math.ceil(radius * target.read.height * 2.1);
      const centreX = Math.round(x * target.read.width);
      const centreY = Math.round(y * target.read.height);
      const left = Math.max(0, centreX - pixelRadius);
      const bottom = Math.max(0, centreY - pixelRadius);
      const right = Math.min(target.read.width, centreX + pixelRadius);
      const top = Math.min(target.read.height, centreY + pixelRadius);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(left, bottom, Math.max(0, right - left), Math.max(0, top - bottom));
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.draw();
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      return;
    }

    const program = this.programs!.splat;
    this.bindTarget(target.write);
    this.use(program);
    this.bindTexture(target.read.texture, 0, program.uniforms.uTarget);
    gl.uniform2f(program.uniforms.uPoint, x, y);
    gl.uniform1f(program.uniforms.uRadius, radius);
    gl.uniform1f(program.uniforms.uAspect, target.read.width / target.read.height);
    gl.uniform4f(program.uniforms.uValue, value[0], value[1], value[2], value[3]);
    gl.uniform1f(program.uniforms.uSeed, seed);
    this.draw();
    target.swap();
  }

  private copyTexture(texture: WebGLTexture, target: Framebuffer): void {
    const program = this.programs!.copy;
    this.bindTarget(target);
    this.use(program);
    this.bindTexture(texture, 0, program.uniforms.uTexture);
    this.draw();
  }

  private bindTarget(target: Framebuffer): void {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
  }

  private use(program: ShaderProgram): void {
    const gl = this.gl!;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.vao);
  }

  private bindTexture(
    texture: WebGLTexture,
    unit: number,
    location: WebGLUniformLocation | null,
  ): void {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }

  private draw(): void {
    this.gl!.drawArrays(this.gl!.TRIANGLES, 0, 3);
  }

  private clearFramebuffer(target: Framebuffer | null): void {
    if (!target || !this.gl) return;
    this.bindTarget(target);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private clearDouble(target: DoubleFramebuffer | null): void {
    if (!target) return;
    this.clearFramebuffer(target.read);
    this.clearFramebuffer(target.write);
  }

  private deleteFramebuffer(target: Framebuffer | null): void {
    if (!target || !this.gl) return;
    this.gl.deleteTexture(target.texture);
    this.gl.deleteFramebuffer(target.framebuffer);
  }

  private deleteDoubleFramebuffer(target: DoubleFramebuffer | null): void {
    if (!target) return;
    this.deleteFramebuffer(target.read);
    this.deleteFramebuffer(target.write);
  }

  private disposeGLResources(): void {
    if (!this.gl) return;
    this.deleteDoubleFramebuffer(this.velocity);
    this.deleteDoubleFramebuffer(this.pressure);
    this.deleteDoubleFramebuffer(this.pigment);
    this.deleteFramebuffer(this.divergence);
    this.deleteFramebuffer(this.curl);
    this.velocity = null;
    this.pressure = null;
    this.pigment = null;
    this.divergence = null;
    this.curl = null;

    if (this.programs) {
      const seen = new Set<WebGLProgram>();
      for (const shader of Object.values(this.programs)) {
        if (!seen.has(shader.program)) {
          this.gl.deleteProgram(shader.program);
          seen.add(shader.program);
        }
      }
    }
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.programs = null;
    this.formats = null;
    this.vao = null;
    this.floatBlendSupported = false;
    this.linearFilteringSupported = false;
  }

  private clearFallback(): void {
    const context = this.fallback2d;
    if (!context) return;
    context.save();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#eee8d9";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.restore();
  }

  private fallbackSplat(
    x: number,
    y: number,
    color: InkColor,
    radius: number,
    amount: number,
  ): void {
    const context = this.fallback2d;
    if (!context) return;
    const px = clamp(x, 0, 1) * this.canvas.width;
    const py = clamp(y, 0, 1) * this.canvas.height;
    const r = clamp(radius, 0.003, 0.35) * Math.min(this.canvas.width, this.canvas.height);
    const toSrgbByte = (component: number): number => {
      const linear = clamp(component, 0, 1);
      const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255);
    };
    const red = toSrgbByte(color?.[0] ?? 0);
    const green = toSrgbByte(color?.[1] ?? 0);
    const blue = toSrgbByte(color?.[2] ?? 0);
    const alpha = clamp(amount * 0.55, 0.05, 0.82);
    const gradient = context.createRadialGradient(px, py, 0, px, py, r * 2);
    gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(${red}, ${green}, ${blue}, ${alpha * 0.45})`);
    gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
    context.save();
    context.globalCompositeOperation = "multiply";
    context.fillStyle = gradient;
    context.fillRect(px - r * 2, py - r * 2, r * 4, r * 4);
    context.restore();
  }

  private clearUnsupportedGL(): void {
    if (!this.gl) return;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0.935, 0.912, 0.855, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
}
