# Claude Skill Editor

A minimalist desktop application for creating, editing, and installing Claude skills with one-click drag-and-drop installation.

![Claude Skill Editor](https://img.shields.io/badge/Electron-v38-blue) ![License](https://img.shields.io/badge/license-MIT-green)


![demo](https://github.com/user-attachments/assets/456f25e7-d39d-4637-ba74-3563ae20b4a8)
---

Claude Desktop/Web offers access to powerful [Claude Skills](https://www.anthropic.com/news/skills): modular prompts & scripts loaded for specific tasks.


Unfortunately, Claude Desktop does not offer native editing for skills. You'd have to store them in a separate folder, edit with a text editor, and create a new ZIP archive & upload every time you want to make an edit. I got tired of how long it took to tweak a skill, so I made something to speed it up.

Introducing **Claude Skill Editor**. Create, edit, and upload skills with only a few clicks (no saving external ZIP archives or managing version separately) but with a *full built-in text editor* for detailed skill editing.


## Installation

### Prerequisites
- Node.js 18+ and npm
- Debian-based Linux system (Ubuntu, Debian, Linux Mint, etc.)

### Build from source

1. **Install dependencies:**
   ```bash
   cd claude-skill-editor
   npm install
   ```
2. **Run the app:**
   ```bash
   npm start
   ```
3. **Build:**
   ```bash
   npm run build:linux # or :mac, :win, :flatpak
   ```
   The output file will be in the `dist` folder.

## Usage

### Creating a New Skill

1. Click **"+ New Skill"** in the sidebar
2. Enter a skill name (e.g., `my-awesome-skill`)
3. Add a description
4. Click **"Create"**

```markdown
---
name: my-awesome-skill
description: A custom Claude skill
---

# my-awesome-skill

Instructions go here
```

You can create any kind of text file, subfolders, upload files, etc. See this Anthropic support article: [Using Skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude).

### Installing skills to Claude Desktop

1. Click **"Package & Install"** or press `Ctrl+P`
2. A draggable package zone appears in the bottom-right
3. In Claude Desktop, go to Settings → Capabilities → Skills
4. Drag your package directly onto the Skills menu (no need to hit "Upload Skill")
5. Your skill is now available in Claude! It will also transfer to your Claude on the web & app-store versions of Claude.

## Credits

Built with:
- [Electron](https://www.electronjs.org/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
