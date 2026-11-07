"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

/**
 * Toast viewport that adapts to the viewport:
 *  - Desktop (≥768px): bottom-right (classic ERP corner).
 *  - Mobile (<768px): top-center — the fixed bottom navigation bar lives at
 *    the bottom of the phone screen, and bottom-positioned toasts covered it
 *    AND intercepted taps on the table rows scrolling beneath it.
 *    Top-center keeps every toast visible, reachable and non-blocking.
 */
const MOBILE = "(max-width: 767px)"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia(MOBILE)
    const update = () => setMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={mobile ? "top-center" : "bottom-right"}
      // On phones keep toasts clear of the sticky 56px app header (56 + 12 gap).
      // sonner v2 applies mobileOffset (not offset) inside its own ≤600px media
      // query, so this only affects phone-sized viewports.
      mobileOffset={mobile ? 68 : undefined}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
