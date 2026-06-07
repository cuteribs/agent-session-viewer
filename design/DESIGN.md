---
name: Modern Pro Agent Viewer
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#464555'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#3130c0'
  on-tertiary: '#ffffff'
  tertiary-container: '#4b4dd8'
  on-tertiary-container: '#d9d8ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '450'
    lineHeight: 20px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  container-padding: 24px
  gutter: 16px
  sidebar-width: 260px
  sidebar-collapsed: 64px
  stack-sm: 8px
  stack-md: 16px
---

## Brand & Style
The design system is engineered for developers and system administrators who require high-density information without cognitive fatigue. It follows a **Modern Pro** aesthetic—a synthesis of high-performance utility and refined, minimalist interface design.

The UI prioritizes clarity, systematic organization, and immediate access to technical data. It avoids decorative flourishes in favor of functional precision. The emotional response is one of reliability, technical sophistication, and control. Every element is designed to feel like a high-end IDE, blending seamlessly into a professional engineering workflow.

## Colors
The color palette is anchored by a high-contrast foundation. The primary **Deep Indigo** is used sparingly for critical actions and active states to maintain focus. 

The neutral palette leverages **Slate** tones to differentiate between surface layers. In light mode, surfaces use subtly different shades of gray to denote hierarchy without relying on heavy shadows. 

Code environments use a dedicated **Obsidian** dark theme regardless of the global UI mode, ensuring that syntax highlighting (utilizing the semantic Emerald, Amber, and Rose tones) remains consistent and highly legible for long-term monitoring.

## Typography
This design system employs a dual-typeface strategy. **Inter** handles all UI scaffolding, navigation, and administrative text, providing a neutral and highly readable foundation. 

**JetBrains Mono** is the workhorse for all technical content, including agent logs, session metadata, and JSON payloads. The line height for code-based text is slightly increased (1.5x) to prevent "wall of text" fatigue during deep debugging sessions. 

For information density, the default body size is set to 14px, with 13px used for secondary metadata. "Label-caps" are used for table headers and section titles to create clear visual separation between content and structure.

## Layout & Spacing
The layout uses a **Fixed-Fluid Hybrid** model. The sidebar is fixed at 260px for navigation, while the main content area uses a fluid 12-column grid to maximize the visibility of logs and data tables.

On desktop, the layout prioritizes horizontal real estate for side-by-side viewing of "Session List" and "Log Detail." On tablet, the layout transitions to a stacked view or a "drawer" pattern for details. 

Spacing follows a strict 4px baseline grid. High-density views use 8px (stack-sm) padding between related elements, while structural sections use 24px (container-padding) to provide necessary breathing room and prevent visual clutter.

## Elevation & Depth
Depth is communicated through **Tonal Layering** and **Low-Contrast Outlines** rather than aggressive shadows. 

1. **Floor:** The main background (#F8FAFC) serves as the canvas.
2. **Surface:** Cards and content containers use a pure white background with a 1px border (#E2E8F0).
3. **Overlay:** Modals and tooltips use a soft, 12% opacity shadow with a 15px blur to lift them from the interface.
4. **Code Surfaces:** Code blocks are recessed, using the dark Obsidian background to create a "well" effect that draws the eye to the technical data.

Interactive elements like buttons use a subtle 1px "inner-glow" on hover to simulate tactile feedback without breaking the flat professional aesthetic.

## Shapes
The design system utilizes a **Soft** shape language. A standard radius of 4px (rounded-md) is applied to buttons, input fields, and small UI components. Larger containers like cards use 8px (rounded-lg).

This subtle rounding maintains a professional, "engineered" look while feeling more modern and accessible than perfectly sharp corners. Circular shapes (pill-shaped) are reserved exclusively for status indicators (chips) and user avatars to distinguish them from functional UI components.

## Components

### Sidebar Navigation
The sidebar uses a dark-themed Slate background. Agent icons (Claude, Codex, etc.) are rendered in monochrome, becoming color-active only when selected. Use a vertical "active indicator" line in the Primary Indigo color on the far left of the active nav item.

### Data Tables
Tables should be borderless with a subtle zebra-stripe (#F1F5F9) on hover. Columns for "Status" use a combination of a colored dot (semantic colors) and a label. Use `code-sm` for IDs and timestamps to emphasize their technical nature.

### Log Entry Cards
Logs are the core of the experience. Each entry is a flat card with a subtle left-border accent corresponding to its log level (e.g., a 3px Rose border for "Error"). Metadata (agent name, latency, token count) should be displayed in a horizontal row using `label-caps` at 60% opacity.

### Search & Filter Bars
Search bars should include a leading icon and a keyboard shortcut hint (e.g., "⌘ K") on the trailing edge. Filter chips should be low-contrast (light gray background) and become Primary Indigo when active.

### Buttons
Primary buttons use solid Indigo with white text. Secondary buttons use a white background with a Slate border and text. Ghost buttons are reserved for utility actions within code blocks (e.g., "Copy", "Expand").