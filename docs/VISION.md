# VISION.md — Custom Mobile Remote Desktop Client

*(Original project-idea writeup, preserved as the product north star.)*

## 1. Core Idea

Build a custom web-based remote desktop client for mobile that provides a
better UX than traditional remote desktop clients.

The goal is **not** to invent a new remote desktop protocol.

Instead, use an existing performant remote-desktop/streaming protocol such
as **Xpra** (primary candidate) or potentially **WebRTC**, while building a
completely custom client UI/UX optimized for phone screens.

The main motivation is that existing remote desktop clients generally
assume:

- a large desktop monitor,
- a physical keyboard,
- a mouse,
- and a conventional desktop viewport.

Those assumptions don't work well on a phone.

The application should treat the phone as a purpose-built remote-computing
device, rather than simply displaying a PC screen inside a small mobile
viewport.

## 2. Primary Requirements

**Performance is mandatory.** The remote display must feel responsive and
low-latency. Important characteristics:

- low input latency
- smooth scrolling
- smooth window movement
- responsive typing
- reasonable performance over Wi-Fi
- potentially usable over cellular networks
- efficient bandwidth usage
- hardware-accelerated decoding where possible

The underlying protocol should handle the difficult networking/display
work. Do not implement a custom remote-display protocol from scratch.

## 3. Why Web

The client should preferably be a web application. Reasons:

- Web UI is extremely flexible.
- Layouts are easy to experiment with.
- CSS makes responsive layouts straightforward.
- React/Svelte/etc. can be used for the UI.
- Custom keyboards and controls are easy to create.
- Touch interaction is well supported.
- Rapid UX iteration is much easier than developing a native mobile UI.
- The same UI could potentially later be packaged using Tauri/Electron/etc.
  if needed.

Electron is not necessarily desired initially; the browser itself should be
the primary UI runtime.

The important separation is:

```
Remote desktop engine  +  Web UI / UX
```

The remote desktop implementation should be an implementation detail
beneath the custom UI.

## 4. Candidate Technologies

### Primary candidate: Xpra

Xpra is currently the most interesting candidate. Reasons:

- It is a real remote-desktop/display protocol rather than merely a video
  stream.
- It already has an HTML5 client.
- It supports browser-based access.
- It handles remote keyboard/input.
- It handles mouse/pointer interaction.
- It supports clipboard and other desktop functionality.
- It supports different display encodings/codecs.
- It has bandwidth/encoding optimizations.
- It has an existing protocol implementation.
- Alternative clients exist.
- The HTML5 client is available as a starting point/reference.
- There are projects exploring more modular/embeddable TypeScript/React
  Xpra clients.

The ideal architecture is:

```
CUSTOM WEB APPLICATION
        │
┌───────┴───────┐
│               │
Custom UI   Input UX
│               │
└───────┬───────┘
        │
   Xpra client
   Xpra protocol
   Xpra server
        │
       PC
```

The existing Xpra HTML5 client should preferably be treated as a
protocol/client implementation to integrate or learn from, rather than
simply forking it and modifying its buttons.

Investigate whether the Xpra client functionality can be cleanly separated
from the UI so that the application can have its own React/Svelte/etc.
frontend.

## 5. WebRTC Alternative

WebRTC is the other major candidate. WebRTC is potentially superior for
pure low-latency screen/video streaming because it provides:

- real-time media transport
- UDP-based networking
- congestion control
- adaptive bitrate
- jitter handling
- packet-loss handling
- hardware video codecs
- browser-native decoding
- excellent browser integration

A pure WebRTC architecture could look like:

```
PC
 ├── screen capture
 ├── video encoder
 └──── WebRTC ────────► Browser
                         <video>
                         Custom Web UI
```

However, WebRTC does not itself provide a complete remote-desktop protocol.
Additional functionality would have to be designed for: keyboard, mouse,
touch, clipboard, shortcuts, screen resizing, desktop semantics, other
remote-control functionality.

WebRTC can provide a data channel for these things, but designing the
semantics starts approaching the problem of creating a custom remote-control
protocol.

Therefore: **Xpra is preferred initially.** WebRTC should be benchmarked as
a potential future alternative if display latency becomes a problem.

## 6. Important Performance Concept

Do not think:

```
TCP = slow
Custom protocol = fast
```

That is an oversimplification. A custom remote-desktop protocol can still
use TCP. Performance depends on the entire architecture:

```
Transport + Encoding + Compression + Flow control + Network adaptation
+ Rendering + Input handling + Buffering/prediction
```

Protocols such as Xpra/NX can achieve good performance because they are
designed specifically for interactive remote display. WebRTC can be
extremely performant because it is designed around real-time media.

The correct approach is therefore:

> **benchmark real workloads** instead of assuming one protocol is faster.

## 7. Main UX Problem

The biggest problem this project is trying to solve is **mobile
remote-desktop ergonomics**. Traditional remote desktop clients usually do
something like:

```
PC desktop → small phone viewport → system keyboard appears
→ keyboard covers large part of screen → user zooms → user pans around
→ user hides keyboard → user needs keyboard again
```

This creates constant context switching. The phone should instead provide a
persistent, purpose-built interaction surface.

## 8. Portrait Mode UX

In portrait mode:

```
┌──────────────────────────┐
│                          │
│     REMOTE DESKTOP       │
│                          │
├──────────────────────────┤
│  CTRL ALT SHIFT TAB ESC  │
├──────────────────────────┤
│  Q W E R T Y U I O P     │
│   A S D F G H J K L      │
│    Z X C V B N M         │
└──────────────────────────┘
```

The important design rule: **the remote display should be top-aligned.** Do
not vertically center the remote display and then let the mobile keyboard
overlay it. If the keyboard occupies the bottom portion of the screen, the
remote viewport should use the remaining area.

```
BAD:                       GOOD:
┌────────────────────┐     ┌────────────────────┐
│    empty space     │     │ REMOTE DESKTOP     │
│  ┌──────────────┐  │     │                    │
│  │   remote     │  │     │                    │
│  │   desktop    │  │     ├────────────────────┤
│  └──────────────┘  │     │ modifiers/shortcuts│
│████████████████████│     ├────────────────────┤
│    keyboard        │     │ keyboard           │
└────────────────────┘     └────────────────────┘
```

The user should be able to see the remote desktop while typing.

## 9. Persistent Keyboard

The keyboard should not behave like a normal mobile OS keyboard that simply
appears and disappears. It should be a **persistent part of the
application.**

Always-visible special keys can include: CTRL, ALT, SHIFT, TAB, ESC, ENTER,
Windows/Super, arrow keys, function keys, HOME, END, PAGE UP, PAGE DOWN.

The user should also be able to create custom buttons for shortcuts.
Examples: `[COPY] [PASTE] [UNDO] [REDO]` or `[CTRL+C] [CTRL+V] [CTRL+Z]` or
custom combinations relevant to the user's workflow.

A button does not necessarily need to represent one physical key. It can
represent: a key combination, a sequence, a macro, a frequently used action.

## 10. Custom Shortcut Bar

The client should have configurable shortcut/control areas. Example:

```
[ESC] [TAB] [CTRL] [ALT] [SHIFT] [←] [↑] [↓] [→]
```

Another possible row:

```
[COPY] [PASTE] [UNDO] [REDO] [CTRL+C] [CTRL+V]
```

Users should eventually be able to customize these.

Potential modes:

- **Navigation mode**: `[ESC] [TAB] [CTRL] [SHIFT] [←] [↑] [↓] [→]`
- **Developer mode**: `[`] [~] [|] [\] [{] [}] [(] [)] [<] [>] [&] [$]`
- **Editing mode**: `[COPY] [PASTE] [UNDO] [REDO] [HOME] [END] [PGUP] [PGDN]`
- **Keyboard mode**: a more traditional keyboard layout when text input is
  the primary task.

## 11. Landscape Mode

Landscape mode is the harder UX problem. A normal PC display might be 16:9.
A phone in landscape does not provide enough space to show a full 16:9
remote display **and** a full keyboard simultaneously. Trying to preserve
the entire 16:9 desktop would make the remote display too small.

Therefore, the idea is to deliberately sacrifice some horizontal screen
area:

```
┌──────────┬────────────────────┬──────────┐
│          │                    │          │
│  LEFT    │   REMOTE SCREEN    │  RIGHT   │
│  INPUT   │                    │  INPUT   │
│          │                    │          │
└──────────┴────────────────────┴──────────┘
```

The center viewport could have a more square aspect ratio, approximately
something like 9:12, rather than preserving 16:9.

The remote desktop is therefore viewed through a larger practical viewport,
rather than trying to display the entire PC monitor at once. Some zooming
and panning will still be required, but substantially less than with a
conventional portrait remote-desktop experience.

## 12. Landscape Keyboard Concept

The keyboard can be divided into two sides:

```
┌──────────┬────────────────────┬──────────┐
│ CTRL     │                    │ ALT      │
│ SHIFT    │                    │ TAB      │
│ ESC      │    PC DISPLAY      │ ENTER    │
│ WIN      │                    │ ← ↑ ↓ →  │
│ COPY     │                    │          │
│ PASTE    │                    │          │
└──────────┴────────────────────┴──────────┘
```

The two sides do not necessarily need to be symmetrical. This is only a
starting concept. The exact geometry should be discovered through
prototyping.

Possible layouts to experiment with: 25/50/25, 20/60/20, 15/70/15,
dynamically sized side panels.

## 13. Avoid Transparent Keyboard as Primary UX

A transparent keyboard overlay initially seems attractive because it saves
space. However:

```
keyboard + remote screen + mouse/touch interaction
```

would all occupy the same physical area. This creates ambiguity: what does
tapping this point mean? Possible interpretations: keyboard press, mouse
click, drag, right click, text interaction, scrolling, gesture.

This can be solved with interaction modes, but that adds complexity and
cognitive load. Therefore: **prefer spatial separation.** The ideal
fundamental layout is:

```
KEYBOARD / CONTROLS
        │
        ▼
┌──────────┬──────────────┬──────────┐
│  INPUT   │ REMOTE SCREEN│  INPUT   │
└──────────┴──────────────┴──────────┘
```

The remote display remains a clean pointer/touch interaction surface.

## 14. Remote Viewport vs Remote Screen

The center display should not necessarily be treated as "the complete PC
screen." It should be treated as a **viewport into** the PC screen. The
viewport can pan when the user needs to reach areas outside the visible
region. The objective is to make the viewport large enough that panning is
relatively infrequent.

## 15. Potential Focus Modes

The application could dynamically change the UI depending on the task. For
example, when editing code, keep the split layout with editor-relevant
shortcuts. When watching video:

```
┌─────────────────────────────────────────────┐
│                                             │
│                   VIDEO                     │
│                                             │
└─────────────────────────────────────────────┘
```

Controls could automatically collapse when unnecessary. The broader
principle: **the layout should adapt to the task** instead of faithfully
reproducing a desktop monitor.

## 16. Product Philosophy

This should NOT be: "A remote desktop application that happens to work on
mobile."

It should be: "**A mobile-first remote-computing environment.**"

The remote PC is still a normal PC. The protocol is still a normal
remote-desktop protocol. But the interaction layer is redesigned
specifically for touchscreen devices.

The client should optimize for: simultaneous viewing + typing, minimal
zooming, minimal panning, persistent keyboard access, custom shortcuts,
one-handed/two-handed operation, landscape productivity, portrait
productivity, fast switching between interaction modes.

## 17. Recommended Initial Technical Direction

Start with:

```
Xpra Server
     │
Xpra Protocol
     │
Xpra HTML5/client implementation
     │
Custom Web Application
   ├── React/Svelte/etc.
   ├── custom layout engine
   ├── custom keyboard
   ├── shortcut system
   ├── touch/mouse interaction
   └── viewport/pan/zoom
```

Do not initially build a custom WebRTC remote-desktop protocol. Instead:

1. Get Xpra working.
2. Build a crude custom web client/UI.
3. Implement the portrait layout.
4. Implement the landscape split-screen layout.
5. Test real-world interaction.
6. Measure latency and bandwidth.
7. Test typing, scrolling, window dragging, IDEs, terminals, video, etc.
8. Only then compare the display path against a minimal WebRTC prototype.

## 18. WebRTC Benchmark Prototype

If Xpra's display performance eventually becomes questionable, create a
deliberately simple WebRTC prototype (screen capture → H.264/HEVC/AV1 →
WebRTC → `<video>`). The only purpose is to answer: *how much better does
WebRTC feel for raw screen streaming?* If the improvement is significant
enough, investigate using WebRTC as the display transport while retaining a
separately designed input/control channel.

## 19. First UX Prototype

Before implementing much protocol code, build the interface with
fake/screenshot desktop content and test the portrait and landscape
layouts, experimenting with the proportions before committing to the exact
design.

The hardest problem is likely not the remote protocol. The hardest problem
is finding the right geometry and interaction model for turning a ~6-inch
touchscreen into a useful desktop terminal.

## 20. Guiding Principle

> **Don't make the PC fit the phone. Make the remote-computing interaction
> model fit the phone.**

Use an existing high-performance remote protocol to handle the difficult
infrastructure. Use the web to build a completely custom mobile UX on top of
it. The protocol should disappear behind the product. The user should
experience a purpose-built mobile computer, not a shrunken PC monitor.
