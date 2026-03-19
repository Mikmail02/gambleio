import { useRef, useEffect, useState, useCallback } from 'react';

const DEFAULT_VOLUME = 0.6;
const FADE_STEPS     = 30;
const FADE_INTERVAL  = 50; // ms → ~1.5s total crossfade

export function useAudio() {
  const baseRef  = useRef<HTMLAudioElement | null>(null);
  const bonusRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef   = useRef(false);
  const masterVolRef = useRef(DEFAULT_VOLUME);
  const prevVolRef   = useRef(DEFAULT_VOLUME); // restored on unmute

  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);

  useEffect(() => {
    const BASE  = import.meta.env.BASE_URL; // '/golden-shower/' in prod, '/' in dev
    const base  = new Audio(`${BASE}audio/base-theme.mp3`);
    base.loop   = true;
    base.volume = 0;

    const bonus  = new Audio(`${BASE}audio/bonus-theme.mp3`);
    bonus.loop   = true;
    bonus.volume = 0;

    baseRef.current  = base;
    bonusRef.current = bonus;

    function onFirstInteract() {
      if (startedRef.current) return;
      startedRef.current = true;
      base.volume = masterVolRef.current;
      base.play().catch(() => {});
      document.removeEventListener('click',   onFirstInteract);
      document.removeEventListener('keydown', onFirstInteract);
    }

    document.addEventListener('click',   onFirstInteract);
    document.addEventListener('keydown', onFirstInteract);

    return () => {
      document.removeEventListener('click',   onFirstInteract);
      document.removeEventListener('keydown', onFirstInteract);
      if (fadeRef.current) clearInterval(fadeRef.current);
      base.pause();
      bonus.pause();
    };
  }, []);

  /** Crossfade from one track to another, respecting current master volume. */
  function crossfade(from: HTMLAudioElement, to: HTMLAudioElement) {
    if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null; }

    const target = masterVolRef.current;
    if (target === 0) {
      // Muted — just swap silently
      from.pause(); from.volume = 0;
      return;
    }

    const fromStart = from.volume;
    to.volume = 0;
    to.play().catch(() => {});

    let step = 0;
    fadeRef.current = setInterval(() => {
      step++;
      const t = step / FADE_STEPS;
      from.volume = Math.max(0, fromStart * (1 - t));
      to.volume   = Math.min(target, target * t);
      if (step >= FADE_STEPS) {
        from.pause();
        from.volume = 0;
        to.volume   = target;
        if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null; }
      }
    }, FADE_INTERVAL);
  }

  /** Apply master volume immediately to whichever track is currently audible. */
  function applyVolume(v: number) {
    const base  = baseRef.current;
    const bonus = bonusRef.current;
    if (base  && !base.paused)  base.volume  = v;
    if (bonus && !bonus.paused) bonus.volume = v;
  }

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    masterVolRef.current = clamped;
    setVolumeState(clamped);
    applyVolume(clamped);
  }, []);

  const toggleMute = useCallback(() => {
    if (masterVolRef.current > 0) {
      prevVolRef.current = masterVolRef.current;
      setVolume(0);
    } else {
      setVolume(prevVolRef.current > 0 ? prevVolRef.current : DEFAULT_VOLUME);
    }
  }, [setVolume]);

  const switchToBonus = useCallback(() => {
    if (!baseRef.current || !bonusRef.current) return;
    if (!startedRef.current) return;
    crossfade(baseRef.current, bonusRef.current);
  }, []);

  const switchToBase = useCallback(() => {
    if (!baseRef.current || !bonusRef.current) return;
    if (!startedRef.current) return;
    crossfade(bonusRef.current, baseRef.current);
  }, []);

  return { switchToBonus, switchToBase, volume, setVolume, toggleMute };
}
