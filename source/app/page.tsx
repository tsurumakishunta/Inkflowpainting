"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FluidEngine, type InkColor } from "./fluid-engine";

type Mode = "manual" | "random" | "auto";

type PaletteColor = {
  id: string;
  name: string;
  reading: string;
  hex: string;
  rgb: InkColor;
};

const PALETTE: PaletteColor[] = [
  { id: "sumi", name: "墨", reading: "すみ", hex: "#17191c", rgb: [0.009, 0.01, 0.013] },
  { id: "shu", name: "朱", reading: "しゅ", hex: "#b84a38", rgb: [0.48, 0.068, 0.04] },
  { id: "midori", name: "緑", reading: "みどり", hex: "#356b57", rgb: [0.036, 0.147, 0.095] },
  { id: "ao", name: "蒼", reading: "あお", hex: "#315f82", rgb: [0.031, 0.114, 0.224] },
];

const MODE_COPY: Record<Mode, { label: string; note: string }> = {
  manual: { label: "手描き", note: "水面をなぞって描く" },
  random: { label: "色うつろい", note: "描くたび、色が移ろう" },
  auto: { label: "墨流し", note: "墨と水に任せる" },
};

type ActivePointer = {
  x: number;
  y: number;
  lastMove: number;
  lastDrop: number;
  color: InkColor;
};

type HoverPointer = {
  pointerId: number;
  anchorX: number;
  anchorY: number;
  anchorTime: number;
  targetX: number;
  targetY: number;
  targetTime: number;
  pending: boolean;
};

function createHoverPointer(
  pointerId: number,
  point: { x: number; y: number },
  now: number,
): HoverPointer {
  return {
    pointerId,
    anchorX: point.x,
    anchorY: point.y,
    anchorTime: now,
    targetX: point.x,
    targetY: point.y,
    targetTime: now,
    pending: false,
  };
}

function mixColor(a: InkColor, b: InkColor, t: number): InkColor {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function colorToCss(color: InkColor) {
  const linearToSrgb = (value: number) =>
    Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
  return `rgb(${linearToSrgb(color[0])} ${linearToSrgb(color[1])} ${linearToSrgb(color[2])})`;
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <label className="range-control">
      <span>{label}</span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--range-progress": `${percent}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FluidEngine | null>(null);
  const pointersRef = useRef(new Map<number, ActivePointer>());
  const hoverPointerRef = useRef<HoverPointer | null>(null);
  const lastWaterStirRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const autoDueRef = useRef(0);
  const autoIndexRef = useRef(0);
  const randomStateRef = useRef({
    current: PALETTE[1].rgb,
    target: PALETTE[3].rgb,
    due: 0,
  });

  const [mode, setMode] = useState<Mode>("auto");
  const [selectedColor, setSelectedColor] = useState(PALETTE[0]);
  const [brush, setBrush] = useState(0.021);
  const [inkLoad, setInkLoad] = useState(0.82);
  const [flow, setFlow] = useState(0.58);
  const [autoSpeed, setAutoSpeed] = useState(0.46);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [notice, setNotice] = useState("");
  const [randomPreview, setRandomPreview] = useState(PALETTE[1].hex);

  const modeRef = useRef(mode);
  const colorRef = useRef(selectedColor);
  const brushRef = useRef(brush);
  const inkLoadRef = useRef(inkLoad);
  const flowRef = useRef(flow);
  const autoSpeedRef = useRef(autoSpeed);
  const pausedRef = useRef(paused);

  useEffect(() => void (modeRef.current = mode), [mode]);
  useEffect(() => void (colorRef.current = selectedColor), [selectedColor]);
  useEffect(() => void (brushRef.current = brush), [brush]);
  useEffect(() => void (inkLoadRef.current = inkLoad), [inkLoad]);
  useEffect(() => void (flowRef.current = flow), [flow]);
  useEffect(() => void (autoSpeedRef.current = autoSpeed), [autoSpeed]);
  useEffect(() => void (pausedRef.current = paused), [paused]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 1800);
  }, []);

  const normalizedPoint = useCallback((event: PointerEvent | ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }, []);

  const chooseRandomTarget = useCallback((now: number) => {
    const state = randomStateRef.current;
    const candidates = PALETTE.filter((item) => item.rgb !== state.target);
    state.target = candidates[Math.floor(Math.random() * candidates.length)].rgb;
    state.due = now + 900 + Math.random() * 1100;
  }, []);

  const dropInk = useCallback(
    (x: number, y: number, dx: number, dy: number, color: InkColor, amount = 1) => {
      engineRef.current?.splat(
        x,
        y,
        dx,
        dy,
        color,
        brushRef.current,
        inkLoadRef.current * amount,
      );
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = normalizedPoint(event);
      const now = performance.now();
      hoverPointerRef.current =
        event.pointerType === "mouse" && event.isPrimary
          ? createHoverPointer(event.pointerId, point, now)
          : null;
      if (modeRef.current === "auto" || pausedRef.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const color =
        modeRef.current === "random"
          ? randomStateRef.current.current
          : colorRef.current.rgb;
      pointersRef.current.set(event.pointerId, {
        ...point,
        lastMove: now,
        lastDrop: now,
        color,
      });
      dropInk(point.x, point.y, 0, 0, color, 1.08);
    },
    [dropInk, normalizedPoint],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = normalizedPoint(event);
      const now = performance.now();
      const pointer = pointersRef.current.get(event.pointerId);
      if (!pointer) {
        if (event.pointerType !== "mouse" || !event.isPrimary || event.buttons !== 0) {
          if (hoverPointerRef.current?.pointerId === event.pointerId) {
            hoverPointerRef.current = null;
          }
          return;
        }

        const hover = hoverPointerRef.current;
        if (!hover || hover.pointerId !== event.pointerId || pausedRef.current) {
          hoverPointerRef.current = createHoverPointer(event.pointerId, point, now);
          return;
        }

        hover.targetX = point.x;
        hover.targetY = point.y;
        hover.targetTime = now;
        hover.pending = true;
        return;
      }

      if (event.buttons === 0) {
        pointersRef.current.delete(event.pointerId);
        hoverPointerRef.current =
          event.pointerType === "mouse" && event.isPrimary
            ? createHoverPointer(event.pointerId, point, now)
            : null;
        return;
      }

      if (pausedRef.current) {
        pointer.x = point.x;
        pointer.y = point.y;
        pointer.lastMove = now;
        pointer.lastDrop = now;
        return;
      }
      const elapsed = Math.max(8, now - pointer.lastMove);
      const deltaX = point.x - pointer.x;
      const deltaY = point.y - pointer.y;
      const distance = Math.hypot(deltaX, deltaY);
      const spacing = Math.max(0.0045, brushRef.current * 0.36);
      const steps = Math.min(24, Math.max(1, Math.ceil(distance / spacing)));
      const velocityScale = Math.min(2.2, 900 / elapsed);

      for (let index = 1; index <= steps; index += 1) {
        const progress = index / steps;
        const color =
          modeRef.current === "random"
            ? mixColor(pointer.color, randomStateRef.current.current, progress)
            : colorRef.current.rgb;
        dropInk(
          pointer.x + deltaX * progress,
          pointer.y + deltaY * progress,
          deltaX * velocityScale,
          deltaY * velocityScale,
          color,
          0.4 + Math.min(0.54, elapsed / 90),
        );
      }

      pointer.x = point.x;
      pointer.y = point.y;
      pointer.lastMove = now;
      pointer.lastDrop = now;
      pointer.color =
        modeRef.current === "random" ? randomStateRef.current.current : colorRef.current.rgb;
      hoverPointerRef.current =
        event.pointerType === "mouse" && event.isPrimary
          ? createHoverPointer(event.pointerId, point, now)
          : null;
    },
    [dropInk, normalizedPoint],
  );

  const releasePointer = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(event.pointerId);
      hoverPointerRef.current =
        event.pointerType === "mouse" && event.isPrimary
          ? createHoverPointer(event.pointerId, normalizedPoint(event), performance.now())
          : null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [normalizedPoint],
  );

  const cancelPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    hoverPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType !== "mouse" || !event.isPrimary || event.buttons !== 0) return;
      hoverPointerRef.current = createHoverPointer(
        event.pointerId,
        normalizedPoint(event),
        performance.now(),
      );
    },
    [normalizedPoint],
  );

  const handlePointerLeave = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      !pointersRef.current.has(event.pointerId) &&
      hoverPointerRef.current?.pointerId === event.pointerId
    ) {
      hoverPointerRef.current = null;
    }
  }, []);

  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.delete(event.pointerId)) hoverPointerRef.current = null;
  }, []);

  const changeMode = useCallback((nextMode: Mode) => {
    setMode(nextMode);
    pointersRef.current.clear();
    hoverPointerRef.current = null;
    autoDueRef.current = performance.now() + 120;
    if (nextMode === "random") chooseRandomTarget(performance.now());
  }, [chooseRandomTarget]);

  const createAutoGesture = useCallback((now: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    const index = autoIndexRef.current;
    const phase = now * 0.00019;
    const x = 0.5 + Math.sin(phase * 1.13) * 0.19 + Math.sin(phase * 2.7) * 0.055;
    const y = 0.51 + Math.cos(phase * 0.91) * 0.16 + Math.sin(phase * 2.15) * 0.045;
    const radius = brushRef.current * (0.66 + Math.random() * 0.34);

    if (index % 4 === 3) {
      engine.disperse(
        x,
        y,
        radius * 4.2,
        0.3 + flowRef.current * 0.26,
        0.075 + flowRef.current * 0.095,
      );
    } else {
      const paletteIndex = index % 7 === 5 ? 1 + ((index / 2) % 3) : 0;
      const color = paletteIndex === 0 ? colorRef.current.rgb : PALETTE[Math.floor(paletteIndex)].rgb;
      const tangentX = Math.cos(phase * 1.7) * 0.008;
      const tangentY = Math.sin(phase * 1.31) * 0.008;
      engine.splat(x, y, tangentX, tangentY, color, radius, 0.64 + inkLoadRef.current * 0.42);
    }

    if (index % 11 === 8) {
      engine.disperse(1 - x * 0.72, 1 - y * 0.7, radius * 2.8, 0.14, 0.055);
    }

    autoIndexRef.current += 1;
    const baseDelay = 1020 - autoSpeedRef.current * 690;
    autoDueRef.current = now + baseDelay * (0.76 + Math.random() * 0.52);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: FluidEngine;
    try {
      engine = new FluidEngine(canvas);
      engineRef.current = engine;
      setUnsupported(!engine.supported);
      setReady(engine.supported);
    } catch {
      setUnsupported(true);
      return;
    }

    engine.resize();
    const resizeObserver = new ResizeObserver(() => engine.resize());
    resizeObserver.observe(canvas);
    autoDueRef.current = performance.now() + 240;

    const renderFrame = (now: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const delta = Math.min(1 / 30, Math.max(1 / 240, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;

      const randomState = randomStateRef.current;
      if (now >= randomState.due) chooseRandomTarget(now);
      randomState.current = mixColor(randomState.current, randomState.target, Math.min(1, delta * 1.7));
      if (modeRef.current === "random" && Math.floor(now / 110) % 2 === 0) {
        setRandomPreview(colorToCss(randomState.current));
      }

      if (!pausedRef.current) {
        const hover = hoverPointerRef.current;
        if (hover?.pending && now - lastWaterStirRef.current >= 30) {
          const anchorX = hover.anchorX;
          const anchorY = hover.anchorY;
          const elapsedMs = hover.targetTime - hover.anchorTime;
          const deltaX = hover.targetX - anchorX;
          const deltaY = hover.targetY - anchorY;
          const distance = Math.hypot(deltaX, deltaY);

          hover.anchorX = hover.targetX;
          hover.anchorY = hover.targetY;
          hover.anchorTime = hover.targetTime;
          hover.pending = false;
          lastWaterStirRef.current = now;

          if (elapsedMs >= 4 && elapsedMs <= 100 && distance >= 0.00035) {
            const elapsedSeconds = Math.max(1 / 240, Math.min(1 / 20, elapsedMs / 1000));
            const velocityX = deltaX / elapsedSeconds;
            const velocityY = deltaY / elapsedSeconds;
            const shortSide = Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
            const physicalVelocityX = (deltaX * canvas.clientWidth) / shortSide / elapsedSeconds;
            const physicalVelocityY = (deltaY * canvas.clientHeight) / shortSide / elapsedSeconds;
            const speed = Math.hypot(physicalVelocityX, physicalVelocityY);
            const speedGain = Math.min(1, Math.max(0, (speed - 0.01) / 0.9));
            const strength =
              (0.25 + speedGain * 0.75) * (0.55 + flowRef.current * 0.45);
            const radius = Math.min(0.065, Math.max(0.018, brushRef.current * 1.6));
            const spacing = Math.max(0.008, brushRef.current * 0.55);
            const motionScale = Math.min(1, 0.16 / distance);
            const pathDeltaX = deltaX * motionScale;
            const pathDeltaY = deltaY * motionScale;
            const pathStartX = hover.targetX - pathDeltaX;
            const pathStartY = hover.targetY - pathDeltaY;
            const pathDistance = distance * motionScale;
            const steps = Math.min(4, Math.max(1, Math.ceil(pathDistance / spacing)));
            const perStepStrength = strength / Math.sqrt(steps);

            for (let index = 1; index <= steps; index += 1) {
              const progress = index / steps;
              engine.stir(
                pathStartX + pathDeltaX * progress,
                pathStartY + pathDeltaY * progress,
                velocityX,
                velocityY,
                radius,
                perStepStrength,
              );
            }
          }
        }

        if (modeRef.current === "auto" && now >= autoDueRef.current) createAutoGesture(now);

        pointersRef.current.forEach((pointer) => {
          if (now - pointer.lastMove > 42 && now - pointer.lastDrop > 54) {
            const color =
              modeRef.current === "random" ? randomState.current : colorRef.current.rgb;
            dropInk(pointer.x, pointer.y, 0, 0, color, 0.24);
            pointer.lastDrop = now;
            pointer.color = color;
          }
        });

        engine.step(delta, {
          flow: flowRef.current,
          diffusion: 0.028 + flowRef.current * 0.052,
        });
      } else {
        const hover = hoverPointerRef.current;
        if (hover) {
          hover.anchorX = hover.targetX;
          hover.anchorY = hover.targetY;
          hover.anchorTime = hover.targetTime;
          hover.pending = false;
        }
        engine.step(0, { flow: 0, diffusion: 0 });
      }

      frameRef.current = requestAnimationFrame(renderFrame);
    };

    frameRef.current = requestAnimationFrame(renderFrame);
    const resetClock = () => {
      lastFrameRef.current = performance.now();
      autoDueRef.current = performance.now() + 180;
      hoverPointerRef.current = null;
      if (document.hidden) {
        for (const pointerId of pointersRef.current.keys()) {
          if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
        }
        pointersRef.current.clear();
      }
    };
    document.addEventListener("visibilitychange", resetClock);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", resetClock);
      engine.destroy();
      engineRef.current = null;
    };
  }, [chooseRandomTarget, createAutoGesture, dropInk]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPaused((value) => !value);
      }
      if (event.key === "1") changeMode("manual");
      if (event.key === "2") changeMode("random");
      if (event.key === "3") changeMode("auto");
      if (event.key.toLowerCase() === "c") {
        engineRef.current?.clear();
        showNotice("水面を清めました");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeMode, showNotice]);

  const saveArtwork = useCallback(() => {
    const dataUrl = engineRef.current?.snapshot();
    if (!dataUrl) return;
    const anchor = document.createElement("a");
    const date = new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll("/", "-");
    anchor.href = dataUrl;
    anchor.download = `suminagashi-${date}.png`;
    anchor.click();
    showNotice("一枚の絵として保存しました");
  }, [showNotice]);

  const clearArtwork = useCallback(() => {
    engineRef.current?.clear();
    autoIndexRef.current = 0;
    autoDueRef.current = performance.now() + 300;
    showNotice("水面を清めました");
  }, [showNotice]);

  const selectedDescription = useMemo(
    () => (mode === "auto" ? "墨を落とし、散らし、流れを重ねています" : MODE_COPY[mode].note),
    [mode],
  );

  return (
    <main className="ink-app">
      <canvas
        ref={canvasRef}
        className="ink-canvas"
        aria-label="墨流しを描く水面。クリックしてなぞると墨が滲み、マウスを押さずに動かすと水だけが流れます。"
        onPointerEnter={handlePointerEnter}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={cancelPointer}
        onPointerLeave={handlePointerLeave}
        onLostPointerCapture={handleLostPointerCapture}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="paper-grain" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="水墨 水と墨の実験室">
          <span className="brand-mark">水墨</span>
          <span className="brand-copy">SUIBOKU<br />LABORATORY</span>
        </a>
        <div className="top-actions">
          <span className={`water-status ${paused ? "is-paused" : ""}`}>
            <i aria-hidden="true" /> {paused ? "静止中" : "水面は流動中"}
          </span>
          <button className="quiet-button" type="button" onClick={() => setPaused((value) => !value)}>
            <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
            {paused ? "再開" : "静止"}
          </button>
          <button className="quiet-button" type="button" onClick={clearArtwork}>
            <span className="clear-symbol" aria-hidden="true">○</span>
            清める
          </button>
          <button className="quiet-button save-button" type="button" onClick={saveArtwork}>
            <span aria-hidden="true">↓</span>
            保存
          </button>
        </div>
      </header>

      <section className="hero-copy" id="top" aria-labelledby="page-title">
        <p className="eyebrow"><span /> 水と墨の実験室</p>
        <h1 id="page-title"><span>水に、</span><span>墨をほどく。</span></h1>
        <p className="hero-note">流れに触れ、色を落とす。<br />偶然が描く一瞬を、眺めてみる。</p>
      </section>

      <section className={`control-deck ${ready ? "is-ready" : ""}`} aria-label="墨流しの操作">
        <div className="deck-primary">
          <div className="mode-tabs" role="group" aria-label="描画モード">
            {(Object.keys(MODE_COPY) as Mode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={mode === item ? "is-active" : ""}
                aria-pressed={mode === item}
                onClick={() => changeMode(item)}
              >
                <span>{MODE_COPY[item].label}</span>
                <small>{item === "manual" ? "01" : item === "random" ? "02" : "03"}</small>
              </button>
            ))}
          </div>

          <div className="mode-detail">
            <div>
              <p className="section-kicker">COLOR / 色</p>
              <div className="palette" role="group" aria-label="墨の色">
                {PALETTE.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={selectedColor.id === item.id ? "is-selected" : ""}
                    aria-label={`${item.name}色を選ぶ`}
                    aria-pressed={selectedColor.id === item.id}
                    onClick={() => setSelectedColor(item)}
                  >
                    <i style={{ backgroundColor: item.hex }} aria-hidden="true" />
                    <span>{item.name}<small>{item.reading}</small></span>
                  </button>
                ))}
                {mode === "random" && (
                  <span className="random-color" title="いま移ろっている色">
                    <i style={{ backgroundColor: randomPreview }} aria-hidden="true" />
                    移ろい中
                  </span>
                )}
              </div>
            </div>
            <p className="mode-description">
              <i aria-hidden="true" />
              {selectedDescription}
            </p>
          </div>
        </div>

        <div className="deck-settings">
          <p className="section-kicker">WATER &amp; INK / 加減</p>
          <div className="range-grid">
            <RangeControl label="筆の太さ" value={brush} min={0.009} max={0.042} step={0.001} onChange={setBrush} />
            <RangeControl label="墨の濃さ" value={inkLoad} min={0.28} max={1.2} step={0.02} onChange={setInkLoad} />
            <RangeControl label="水の流れ" value={flow} min={0.08} max={1} step={0.02} onChange={setFlow} />
            {mode === "auto" && (
              <RangeControl label="落とす間合い" value={autoSpeed} min={0.08} max={1} step={0.02} onChange={setAutoSpeed} />
            )}
          </div>
        </div>
      </section>

      <div className="gesture-hint" aria-hidden="true">
        <span className="gesture-ring"><i /></span>
        {mode === "auto"
          ? "マウスを動かすと、水が流れる"
          : "クリックで墨、移動だけなら水を動かす"}
      </div>

      {unsupported && (
        <div className="unsupported" role="alert">
          <strong>この水面を描画できませんでした。</strong>
          <span>WebGL 2に対応した新しいブラウザーで開いてみてね。</span>
        </div>
      )}

      <div className={`notice ${notice ? "is-visible" : ""}`} role="status" aria-live="polite">
        {notice}
      </div>

      <p className="signature" aria-hidden="true">Sumi · Water · Time</p>
    </main>
  );
}
