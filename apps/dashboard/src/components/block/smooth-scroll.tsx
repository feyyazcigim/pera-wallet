'use client'
import { type ReactNode, useEffect } from 'react'
import type Lenis from 'lenis'

export function SmoothScroll({ children }: { children: ReactNode }) {
    useEffect(() => {
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
        let disposed = false
        let generation = 0
        let instance: Lenis | null = null
        let frame: number | null = null

        const stop = () => {
            generation++
            if (frame !== null) cancelAnimationFrame(frame)
            frame = null
            instance?.destroy()
            instance = null
        }

        const update = async () => {
            stop()
            if (disposed || preference.matches) return
            const currentGeneration = generation
            try {
                const LenisClass = (await import('lenis')).default
                if (disposed || preference.matches || currentGeneration !== generation) return
                instance = new LenisClass({
                    duration: 1.1,
                    anchors: true,
                    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                    orientation: 'vertical',
                    gestureOrientation: 'vertical',
                    smoothWheel: true,
                    wheelMultiplier: 1,
                    touchMultiplier: 2,
                    infinite: false,
                })

                function raf(time: number) {
                    if (disposed || !instance || currentGeneration !== generation) return
                    instance.raf(time)
                    frame = requestAnimationFrame(raf)
                }
                frame = requestAnimationFrame(raf)
            } catch (e) {
                console.warn('Lenis not available:', e)
            }
        }

        void update()
        preference.addEventListener('change', update)

        return () => {
            disposed = true
            preference.removeEventListener('change', update)
            stop()
        }
    }, [])

    return <>{children}</>
}

export default SmoothScroll
