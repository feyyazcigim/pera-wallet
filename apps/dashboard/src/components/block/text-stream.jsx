"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";
import "./text-stream.css";

const BLUR_LAYERS = [
  { blur: 1.2, reach: 42 },
  { blur: 3, reach: 30 },
  { blur: 6, reach: 18 },
  { blur: 10, reach: 9 },
];

/**
 * @param {{
 *   items?: string[], prefix?: string, fontSize?: string, fontWeight?: number,
 *   height?: string | number, paused?: boolean, className?: string,
 *   style?: import('react').CSSProperties,
 *   scroller?: HTMLElement | Window | import('react').RefObject<HTMLElement | null>
 * }} props
 */
export function TextStream({
  items = [],
  prefix = "ObsidianUI",
  fontSize = "clamp(1.25rem, 3vw, 2.25rem)",
  fontWeight = 200,
  height = "100vh",
  scroller,
  paused = false,
  className,
  style,
}) {
  const trackRef = useRef(null);
  const contentRef = useRef(null);
  const containerRef = useRef(null);
  const [copyCount, setCopyCount] = useState(2);
  const metricsRef = useRef({
    currentY: 0,
    distance: 0,
    currentVelocity: 0.6,
    targetVelocity: 0.6,
    lastScrollDirection: 1,
  });
  const scrollTimeoutRef = useRef(null);

  useEffect(() => {
    const track = trackRef.current;
    const content = contentRef.current;
    const container = containerRef.current;
    if (!track || !content || !container || paused || !items.length) return;

    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const baseSpeed = 0.6;
      const maxBoost = 12;
      const scrollTarget = (scroller?.current !== undefined ? scroller.current : scroller) ?? window;
      const readScroll = () => scrollTarget === window ? window.scrollY : scrollTarget.scrollTop;
      let lastScrollY = readScroll();

      const startAnimation = () => {
        const distance = content.offsetHeight;
        const containerHeight = container.offsetHeight;
        if (!distance || !containerHeight) return;

        const nextCopyCount = Math.max(2, Math.ceil(containerHeight / distance) + 2);
        setCopyCount((c) => (c === nextCopyCount ? c : nextCopyCount));
        metricsRef.current.distance = distance;

        metricsRef.current.currentY = gsap.utils.wrap(-distance, 0, metricsRef.current.currentY);

        gsap.set(track, { y: metricsRef.current.currentY });
      };

      const tick = (_, deltaTime) => {
        const { distance } = metricsRef.current;
        if (!distance) return;

        const frameFactor = deltaTime / (1000 / 60);
        metricsRef.current.currentVelocity = gsap.utils.interpolate(
          metricsRef.current.currentVelocity,
          metricsRef.current.targetVelocity,
          0.14
        );
        metricsRef.current.currentY += metricsRef.current.currentVelocity * frameFactor;

        metricsRef.current.currentY = gsap.utils.wrap(-distance, 0, metricsRef.current.currentY);

        gsap.set(track, { y: metricsRef.current.currentY });
      };

      const applyScrollMotion = (delta) => {
        if (!delta) return;
        const direction = delta > 0 ? -1 : 1;
        const boost = Math.min(maxBoost, baseSpeed + Math.pow(Math.abs(delta), 1.2) * 0.08);
        metricsRef.current.lastScrollDirection = direction;
        metricsRef.current.targetVelocity = direction * boost;
        window.clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = window.setTimeout(() => {
          metricsRef.current.targetVelocity = metricsRef.current.lastScrollDirection * baseSpeed;
        }, 120);
      };

      const handleWheel  = (e) => applyScrollMotion(e.deltaY);
      const handleScroll = () => {
        const next = readScroll();
        applyScrollMotion(next - lastScrollY);
        lastScrollY = next;
      };

      startAnimation();
      gsap.ticker.add(tick);

      const ro = new ResizeObserver(startAnimation);
      ro.observe(content);
      ro.observe(container);
      window.addEventListener("resize", startAnimation);
      scrollTarget.addEventListener("wheel",  handleWheel,  { passive: true });
      scrollTarget.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        ro.disconnect();
        window.removeEventListener("resize", startAnimation);
        scrollTarget.removeEventListener("wheel",  handleWheel);
        scrollTarget.removeEventListener("scroll", handleScroll);
        window.clearTimeout(scrollTimeoutRef.current);
        gsap.ticker.remove(tick);
      };
    }, containerRef);

    return () => media.revert();
  }, [items, paused, scroller]);

  if (!items.length) return null;

  return (
    <div className={cn("obsidian-text-stream font-heading text-foreground", className)} style={{ display: "flex", height, ...style }}>
      {/* Left — static prefix */}
      <div style={{ width: "45%", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8 }}>
        <p style={{ fontSize, fontWeight, lineHeight: 1, whiteSpace: "nowrap", margin: 0 }}>
          {prefix}
        </p>
      </div>

      {/* Right — scrolling marquee */}
      <div
        ref={containerRef}
        className="obsidian-text-stream__viewport"
        style={{
          position: "relative", width: "55%", height: "100%", overflow: "hidden", fontSize,
          maskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.08) 14%, rgba(0,0,0,0.28) 30%, rgba(0,0,0,0.62) calc(50% - 1.15em), #000 calc(50% - 0.45em), #000 calc(50% + 0.45em), rgba(0,0,0,0.62) calc(50% + 1.15em), rgba(0,0,0,0.28) 70%, rgba(0,0,0,0.08) 86%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.08) 14%, rgba(0,0,0,0.28) 30%, rgba(0,0,0,0.62) calc(50% - 1.15em), #000 calc(50% - 0.45em), #000 calc(50% + 0.45em), rgba(0,0,0,0.62) calc(50% + 1.15em), rgba(0,0,0,0.28) 70%, rgba(0,0,0,0.08) 86%, transparent 100%)",
        }}
      >
        <div
          ref={trackRef}
          className="obsidian-text-stream__track"
          style={{ position: "absolute", left: 0, top: 0, display: "flex", flexDirection: "column", fontSize, fontWeight, lineHeight: 1 }}
        >
          {Array.from({ length: copyCount }, (_, copyIndex) => (
            <div
              key={copyIndex}
              ref={copyIndex === 0 ? contentRef : null}
              className="obsidian-text-stream__copy"
              style={{ display: "flex", flexDirection: "column" }}
              aria-hidden={copyIndex > 0}
            >
              {items.map((text, i) => (
                <div key={`${copyIndex}-${i}`} style={{ padding: "4px 0 4px 8px", whiteSpace: "nowrap" }}>
                  {text}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* pera.: progressive blur — sharp on the center line, softer toward the top and bottom edges */}
        {BLUR_LAYERS.map(({ blur, reach }) => {
          const m = `linear-gradient(to bottom, #000 0%, transparent ${reach}%, transparent ${100 - reach}%, #000 100%)`;
          return (
            <div
              key={blur}
              aria-hidden="true"
              className="obsidian-text-stream__blur"
              style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)`,
                maskImage: m, WebkitMaskImage: m,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
