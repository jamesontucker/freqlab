<p align="center">
  <img src=".github/icon.svg" alt="freqlab icon" height="80">
</p>
<h1 align="center">freqlab</h1>

<p align="center">
  <strong>A macOS app for creating VST3/CLAP audio plugins through conversation.</strong>
</p>

> This is a personal side project I initally build for my wife who's a sound designer and is not consistently maintained. It was a vibe experiement, so use as-is.
> Also go hire a dev if you're looking to take plugin development seriously ;)

---

## What is freqlab?

Most AI apps are trying to replace traditional music/audio creative flows (ie. suno and other gen-ai garbage), I wanted to create something that genuinely assists their creative process instead of replacing it.

This was made for producers and sound designers who aren't developers who've always dreamed of creating unique plugins for their projects.

### The Workflow

```
Describe → Build → Preview → Iterate
```

1. Create a plugin project and choose a template
2. Chat to describe what you want, claude code writes the Rust code
3. One-click build compiles your plugin
4. Hot reload lets you hear changes instantly and experiement with the preview panel (send input singals).
5. Revert to any version if something breaks
6. Publish directly to your DAW

---

## Features

### Conversational Development

| Feature                         | Description                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------ |
| **Per-project Claude sessions** | Each plugin has its own Claude agent with full context of your plugin codebase |
| **Streaming responses**         | See Claude's work in real-time as it writes code                               |
| **Automatic versioning**        | Every change is git-committed with one-click revert                            |
| **File attachments**            | Drop in reference files, specs, or examples                                    |

### Audio Preview

| Feature             | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| **Hot reload**      | Plugin reloads automatically when code changes—no restart needed |
| **Test signals**    | Built-in sine, noise, sweep, impulse, and chirp generators       |
| **Sample playback** | Load WAV, MP3, or AAC files as input                             |
| **Level metering**  | Real-time output monitoring                                      |

### Build System

| Feature                 | Description                                       |
| ----------------------- | ------------------------------------------------- |
| **One-click builds**    | Compile VST3 + CLAP with a single button          |
| **Streaming output**    | Watch the build in real-time, catch errors early  |
| **Versioned artifacts** | Each build saves to `output/{name}/v{version}/`   |
| **DAW publishing**      | Copy plugins directly to your DAW's plugin folder |

### Plugin Templates

Choose your starting point:

| Type           | UI Framework              | Description              |
| -------------- | ------------------------- | ------------------------ |
| **Effect**     | WebView / egui / Headless | Process incoming audio   |
| **Instrument** | WebView / egui / Headless | Generate audio from MIDI |

---

## Prerequisites

-   **macOS 12+** (Monterey or later)
-   **Xcode Command Line Tools** — `xcode-select --install`
-   **Rust** — via [rustup](https://rustup.rs/)
-   **Claude Code CLI** — requires an active Anthropic subscription

freqlab on-boarding checks these on first launch.

---

## Installation

```bash
git clone https://github.com/jamesontucker/freqlab.git
cd freqlab
npm install
npm run tauri dev
```

Or build a release:

```bash
npm run tauri build
```

---

## Known Issues

### Unsigned Plugins

Plugins are unsigned, so macOS Gatekeeper may block them. Remove the quarantine flag:

```bash
xattr -cr /path/to/YourPlugin.clap
xattr -cr /path/to/YourPlugin.vst3
```

### Code Review

Claude generates the plugin code. While templates include safety limiters, always review generated code before distributing. You're generating rust, so make sure to understand what it's doing!

---

## License

freqlab is **GPL-3.0**. See [LICENSE](LICENSE).

### Plugin Licensing

Plugins use [nih-plug](https://github.com/robbert-vdh/nih-plug):

-   **nih-plug framework** — ISC license
-   **VST3 bindings** — GPL-3.0

**What this means:**

-   VST3 plugins must be GPL-3.0 (provide source on request)
-   CLAP-only plugins have no such requirement
-   You can sell plugins, but must share source if asked. But to be honest, just make them for yourself and share with your friends. If you want to actually sell plugins you should be hring a developer or learning to code!

---

## Contributing

Contributions are generally welcome, but this is a side project with irregular maintenance. Mostly just experimenting right now.

---

<p align="center">
  Built with <a href="https://tauri.app/">Tauri</a> · <a href="https://github.com/robbert-vdh/nih-plug">nih-plug</a> · <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>
</p>
