// State
let currentSkill = null;
let currentSkillDir = null; // Skill directory path for multi-file operations
let currentFile = null; // { path, name, type, editable, metadata }
let editor = null;
let zipPath = null;
let hasUnsavedChanges = false;
let autoSaveDebounceTimer = null;
let fileTree = null; // Current skill's file tree
let contextMenuTarget = null; // Target node for context menu operations
let suppressEditorChange = false;
let currentSkillItem = null; // Active skill element in the list
let currentFileTreeContainer = null; // Active skill's file tree wrapper

// Monaco Editor Setup
if (typeof require !== 'undefined' && typeof require.config === 'function') {
  require.config({ paths: { vs: 'node_modules/monaco-editor/min/vs' } });

  require(['vs/editor/editor.main'], function () {
    editor = monaco.editor.create(document.getElementById('editor'), {
      value: '',
      language: 'markdown',
      theme: 'vs-dark',
      fontSize: 14,
      lineNumbers: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      fontFamily: "'Lora', Georgia, serif",
      lineHeight: 24,
      suggest: { enabled: false },
      quickSuggestions: { enabled: false },
      tabCompletion: 'off',
      wordBasedSuggestions: 'off',
      acceptSuggestionOnEnter: 'off',
      acceptSuggestionOnCommitCharacter: false,
      parameterHints: { enabled: false }
    });

    // Custom theme matching Claude colors
    monaco.editor.defineTheme('claude-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: 'b0aea5' },
        { token: 'keyword', foreground: 'd97757' },
        { token: 'string', foreground: '788c5d' },
        { token: 'number', foreground: '6a9bcc' }
      ],
      colors: {
        'editor.background': '#141413',
        'editor.foreground': '#faf9f5',
        'editorLineNumber.foreground': '#b0aea5',
        'editor.selectionBackground': '#d9775733',
        'editor.lineHighlightBackground': '#faf9f50a'
      }
    });

    monaco.editor.setTheme('claude-dark');

    // Auto-save on change with debounce
    editor.onDidChangeModelContent(() => {
      if (suppressEditorChange) {
        return;
      }

      hasUnsavedChanges = true;

      // Clear previous debounce timer
      if (autoSaveDebounceTimer) {
        clearTimeout(autoSaveDebounceTimer);
      }

      // Set new debounce timer for 2 seconds
      autoSaveDebounceTimer = setTimeout(() => {
        autoSave();
      }, 2000);
    });

    loadSkills();
  });
} else {
  // Fallback: Load skills if Monaco fails to load
  setTimeout(() => {
    try {
      loadSkills();
    } catch (e) {
      console.error('Failed to load skills:', e);
    }
  }, 100);
}

// DOM Elements
const newSkillBtn = document.getElementById('newSkillBtn');
const openSkillBtn = document.getElementById('openSkillBtn');
const packageBtn = document.getElementById('packageBtn');
const deleteBtn = document.getElementById('deleteBtn');
const dragZone = document.getElementById('dragZone');
const emptyState = document.getElementById('emptyState');
const newSkillModal = document.getElementById('newSkillModal');
const cancelBtn = document.getElementById('cancelBtn');
const createBtn = document.getElementById('createBtn');
const skillNameInput = document.getElementById('skillNameInput');
const skillDescInput = document.getElementById('skillDescInput');
const skillsList = document.getElementById('skillsList');
const editorTitle = document.getElementById('editorTitle');
const deleteConfirmModal = document.getElementById('deleteConfirmModal');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
const deleteSkillName = document.getElementById('deleteSkillName');

// Multi-file UI elements
const contextMenu = document.getElementById('contextMenu');
const createItemModal = document.getElementById('createItemModal');
const createItemTitle = document.getElementById('createItemTitle');
const itemNameInput = document.getElementById('itemNameInput');
const itemNameHint = document.getElementById('itemNameHint');
const createItemCancelBtn = document.getElementById('createItemCancelBtn');
const createItemConfirmBtn = document.getElementById('createItemConfirmBtn');
const deleteItemModal = document.getElementById('deleteItemModal');
const deleteItemTitle = document.getElementById('deleteItemTitle');
const deleteItemMessage = document.getElementById('deleteItemMessage');
const deleteItemCancelBtn = document.getElementById('deleteItemCancelBtn');
const deleteItemConfirmBtn = document.getElementById('deleteItemConfirmBtn');
const renameModal = document.getElementById('renameModal');
const renameInput = document.getElementById('renameInput');
const renameCancelBtn = document.getElementById('renameCancelBtn');
const renameConfirmBtn = document.getElementById('renameConfirmBtn');
const uploadDropZone = document.getElementById('uploadDropZone');
const fileNotEditablePlaceholder = document.getElementById('fileNotEditablePlaceholder');
const fileNotEditableInfo = document.getElementById('fileNotEditableInfo');
const fileInfo = document.getElementById('fileInfo');

function deactivateDragZone() {
  if (!dragZone) {
    return;
  }
  dragZone.classList.remove('active');
  zipPath = null;
}

const modalConfirmPairs = [
  { modal: newSkillModal, confirmButton: createBtn },
  { modal: deleteConfirmModal, confirmButton: deleteConfirmBtn },
  { modal: createItemModal, confirmButton: createItemConfirmBtn },
  { modal: deleteItemModal, confirmButton: deleteItemConfirmBtn },
  { modal: renameModal, confirmButton: renameConfirmBtn }
];

// Test listener for input debugging
let inputTestListener = null;
let valueMonitorInterval = null;

// Utility functions
function normalizePath(pathString) {
  return typeof pathString === 'string' ? pathString.replace(/\\/g, '/') : pathString;
}

function getParentDirectory(pathString) {
  const normalized = normalizePath(pathString || '');
  if (!normalized) return '';
  const segments = normalized.split('/');
  segments.pop();
  return segments.join('/');
}

function getRelativePath(fullPath, basePath) {
  // Extract relative path from a full path using the base path
  const normalizedFull = normalizePath(fullPath);
  const normalizedBase = normalizePath(basePath);
  if (!normalizedFull || !normalizedBase) {
    return normalizedFull;
  }
  if (!normalizedFull.startsWith(normalizedBase + '/')) {
    return normalizedFull;
  }
  return normalizedFull.substring(normalizedBase.length + 1);
}

function getFileIcon(node) {
  if (node.type === 'folder') return '📁';
  const ext = node.name.split('.').pop().toLowerCase();
  const icons = {
    'md': '📝',
    'txt': '📄',
    'js': '🔨',
    'py': '🐍',
    'json': '⚙️',
    'html': '🌐',
    'css': '🎨',
    'yaml': '⚙️',
    'yml': '⚙️',
    'sh': '💻',
    'rb': '💎',
  };
  return icons[ext] || '📄';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function getActiveModalConfirmButton() {
  for (const { modal, confirmButton } of modalConfirmPairs) {
    if (modal && confirmButton && modal.classList.contains('active')) {
      return confirmButton;
    }
  }
  return null;
}

function setEditorContent(value, options = {}) {
  if (!editor) return;

  const { markClean = true } = options;

  suppressEditorChange = true;
  try {
    editor.setValue(value);
  } finally {
    suppressEditorChange = false;
  }

  if (markClean) {
    hasUnsavedChanges = false;
    if (autoSaveDebounceTimer) {
      clearTimeout(autoSaveDebounceTimer);
      autoSaveDebounceTimer = null;
    }
  }
}

function refreshActiveFileHighlight() {
  document.querySelectorAll('.file-tree-node.file.active').forEach(node => node.classList.remove('active'));

  if (!currentFile || !currentFile.path) {
    return;
  }

  const nodeId = `file-node-${currentFile.path.replace(/\//g, '-')}`;
  const activeNode = document.getElementById(nodeId);
  if (activeNode) {
    activeNode.classList.add('active');
  }
}

function renderFileTree(nodes) {
  if (!nodes || nodes.length === 0) {
    return '<div class="file-tree-empty" style="color: var(--mid-gray); padding: 16px 8px; font-size: 12px;">No files</div>';
  }

  let html = '';
  for (const node of nodes) {
    // node.path already contains the complete relative path from backend
    const nodeId = `file-node-${node.path.replace(/\//g, '-')}`;

    if (node.type === 'folder') {
      const hasChildren = node.children && node.children.length > 0;
      html += `<div class="file-tree-node folder" data-node-id="${nodeId}" data-node-path="${node.path}" data-node-type="folder" data-expanded="true">`;
      // Always show toggle (even for empty folders - they can have items added to them)
      html += `<div class="file-tree-toggle expanded" data-toggle="${nodeId}"></div>`;
      html += `<span class="file-tree-icon folder-icon">${hasChildren ? '📂' : '📁'}</span>`;
      html += `<span class="folder-name">${node.name}</span>`;
      html += `</div>`;
      // Always create children container (even if empty, for future items)
      html += `<div class="file-tree-children expanded" id="${nodeId}">`;
      if (hasChildren) {
        html += renderFileTree(node.children);
      }
      html += `</div>`;
    } else {
      const editable = node.editable ? 'editable' : 'not-editable';
      html += `<div class="file-tree-node file ${editable}" data-node-id="${nodeId}" data-node-path="${node.path}" data-node-type="file" data-editable="${node.editable ? 'true' : 'false'}">`;
      html += `<div class="file-tree-toggle" style="visibility: hidden;"></div>`;
      html += `<span class="file-tree-icon">${getFileIcon(node)}</span>`;
      html += `<span>${node.name}</span>`;
      html += `</div>`;
    }
  }
  return html;
}

async function loadFileTree() {
  if (!currentSkill || !currentFileTreeContainer) {
    return;
  }

  try {
    const result = await window.electronAPI.listSkillFiles(currentSkill.path);

    if (result.success) {
      fileTree = result.files;
      const html = renderFileTree(fileTree);
      currentFileTreeContainer.innerHTML = html;
      attachRootDropHandlers(currentFileTreeContainer);
      attachFileTreeEventListeners(currentFileTreeContainer);
      refreshActiveFileHighlight();
    } else {
      showNotification('Failed to load files: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error loading file tree:', error);
    showNotification('Error loading files', 'error');
  }
}

function attachFileTreeEventListeners(root) {
  const scope = root || document;

  // File click to load
  scope.querySelectorAll('.file-tree-node.file').forEach(node => {
    // Make files draggable
    node.setAttribute('draggable', 'true');

    node.addEventListener('click', async (e) => {
      e.stopPropagation();
      await autoSave();
      const nodePath = node.getAttribute('data-node-path');
      loadFileFromTree(nodePath);
    });

    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextMenuTarget = node;
      const nodePath = node.getAttribute('data-node-path');
      showContextMenu(e.clientX, e.clientY, 'file');
    });

    // Drag start - store what file is being dragged
    node.addEventListener('dragstart', (e) => {
      const filePath = node.getAttribute('data-node-path');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', filePath);
      e.dataTransfer.setData('application/x-skill-file', filePath);
      node.classList.add('dragging');
    });

    node.addEventListener('dragend', (e) => {
      node.classList.remove('dragging');
    });
  });

  // Folder click to expand/collapse (anywhere on the row)
  scope.querySelectorAll('.file-tree-node.folder').forEach(node => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolder(node);
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextMenuTarget = node;
      const nodePath = node.getAttribute('data-node-path');
      showContextMenu(e.clientX, e.clientY, 'folder');
    });

    // Add drag-and-drop support for folders
    node.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.add('drag-over');
    });

    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Check if it's internal or external file
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('application/x-skill-file')) {
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    node.addEventListener('dragleave', (e) => {
      // Only remove highlight if we're actually leaving the folder node
      // Check if the relatedTarget (where we're going) is NOT a child of this node
      if (!node.contains(e.relatedTarget)) {
        node.classList.remove('drag-over');
      }
    });

    node.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove('drag-over');

      if (!currentSkill) {
        return;
      }

      const targetFolder = node.getAttribute('data-node-path');

      // Check if this is an internal file move
      // Try custom MIME type first, then fall back to text/plain
      let internalFilePath = e.dataTransfer.getData('application/x-skill-file');
      if (!internalFilePath) {
        internalFilePath = e.dataTransfer.getData('text/plain');
      }

      // Check if it's actually an internal file (has no slashes at start, indicating a relative path)
      if (internalFilePath && !internalFilePath.startsWith('/') && !internalFilePath.startsWith('file:')) {
        await moveFileToFolder(internalFilePath, targetFolder);
        return;
      }

      // Otherwise, it's an external file upload
      const items = e.dataTransfer.items;
      if (!items || items.length === 0) {
        return;
      }

      const filesToUpload = [];
      const entries = Array.from(items)
        .map(item => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
        .filter(Boolean);

      const traverseFileTree = async (entry, path = '') => {
        if (entry.isFile) {
          const file = await new Promise((resolve, reject) => {
            entry.file(resolve, reject);
          });
          const data = await file.arrayBuffer();
          filesToUpload.push({
            name: path ? `${path}/${file.name}` : file.name,
            data: new Uint8Array(data)
          });
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const entries = await new Promise((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });
          for (const childEntry of entries) {
            await traverseFileTree(childEntry, path ? `${path}/${entry.name}` : entry.name);
          }
        }
      };

      for (const entry of entries) {
        await traverseFileTree(entry);
      }

      if (filesToUpload.length > 0) {
        await uploadFiles(filesToUpload.map(f => ({
          arrayBuffer: () => Promise.resolve(f.data),
          webkitRelativePath: f.name,
          name: f.name.split('/').pop()
        })), targetFolder, true);
      }
    });
  });

  // Folder toggle icon click (in addition to folder row)
  scope.querySelectorAll('.file-tree-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const folderNode = toggle.closest('.file-tree-node.folder');
      if (folderNode) {
        toggleFolder(folderNode);
      }
    });
  });
}

function toggleFolder(folderNode) {
  const nodeId = folderNode.getAttribute('data-node-id');
  const toggle = folderNode.querySelector('.file-tree-toggle');
  const folderIcon = folderNode.querySelector('.folder-icon');
  const childrenContainer = document.getElementById(nodeId);

  if (!childrenContainer) return;

  // Toggle expanded state
  const isExpanded = folderNode.getAttribute('data-expanded') === 'true';
  folderNode.setAttribute('data-expanded', !isExpanded);

  // Update toggle icon
  toggle.classList.toggle('expanded');
  toggle.classList.toggle('collapsed');

  // Update folder icon
  if (folderIcon) {
    folderIcon.textContent = isExpanded ? '📁' : '📂';
  }

  // Update children visibility
  childrenContainer.classList.toggle('expanded');
  childrenContainer.classList.toggle('collapsed');
}

async function loadFileFromTree(filePath) {
  console.log('=== LOADING FILE FROM TREE ===', filePath);
  if (!currentSkill || !currentSkillDir) return;

  deactivateDragZone();

  // Auto-save before switching files
  await autoSave();

  // Ensure filePath is relative
  const relativeFilePath = getRelativePath(filePath, currentSkillDir);
  const fullPath = `${currentSkillDir}/${relativeFilePath}`;

  try {
    const result = await window.electronAPI.loadFile({ filePath: fullPath });
    if (result.success) {
      currentFile = {
        ...result.metadata,
        path: relativeFilePath  // Always store relative path (override metadata's full path)
      };

      // Update active highlighting
      refreshActiveFileHighlight();

      // Update editor based on editability
      if (result.metadata.editable) {
        console.log('Loading editable file into Monaco');
        setEditorContent(result.content);
        editor.getModel().setLanguage(getLanguageMode(filePath));
        fileNotEditablePlaceholder.style.display = 'none';
        emptyState.style.display = 'none';
        document.getElementById('editor').style.display = 'flex';
        console.log('Monaco editor display:', document.getElementById('editor').style.display);
        console.log('Monaco editor is read-only:', editor.getModel().getOptions().readOnly);
        // Force focus on the Monaco editor
        setTimeout(() => {
          editor.focus();
          console.log('Monaco focused, active element:', document.activeElement);
          console.log('Monaco has focus:', editor.hasTextFocus());
        }, 50);
      } else {
        document.getElementById('editor').style.display = 'none';
        emptyState.style.display = 'none';
        fileNotEditablePlaceholder.style.display = 'flex';
        const typeInfo = `Type: ${result.metadata.type} | Size: ${formatFileSize(result.metadata.size)}`;
        fileNotEditableInfo.textContent = typeInfo;
      }

      // Update toolbar
      editorTitle.textContent = `${currentSkill.name} / ${currentFile.name}`;
      fileInfo.textContent = result.metadata.editable ? '' : '(Not editable)';
      packageBtn.disabled = false;
    } else {
      showNotification('Failed to load file: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error loading file:', error);
    showNotification('Error loading file', 'error');
  }
}

function getLanguageMode(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const modes = {
    'md': 'markdown',
    'txt': 'plaintext',
    'js': 'javascript',
    'py': 'python',
    'json': 'json',
    'html': 'html',
    'css': 'css',
    'yaml': 'yaml',
    'yml': 'yaml',
    'sh': 'shell',
  };
  return modes[ext] || 'plaintext';
}

function showContextMenu(x, y, type) {
  const contextMenuItems = contextMenu.querySelectorAll('.context-menu-item');

  if (type === 'file') {
    // Show/hide items based on file operations
    contextMenuItems.forEach(item => {
      const action = item.getAttribute('data-action');
      if (action === 'new-file' || action === 'new-folder' || action === 'upload-files' || action === 'upload-folder') {
        item.style.display = 'none';
      } else {
        item.style.display = 'block';
      }
    });
  } else {
    // Show all items for folder
    contextMenuItems.forEach(item => item.style.display = 'block');
  }

  contextMenu.style.display = 'block';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
}

function hideContextMenu() {
  console.log('hideContextMenu called');
  contextMenu.style.display = 'none';
  console.log('contextMenu display after hiding:', contextMenu.style.display);
  // Don't clear contextMenuTarget here - it's needed for modal operations
  // It will be cleared when the modal is closed or action is completed
}

// Event Listeners
newSkillBtn.addEventListener('click', async () => {
  await autoSave();
  newSkillModal.classList.add('active');
  skillNameInput.focus();
});

cancelBtn.addEventListener('click', () => {
  newSkillModal.classList.remove('active');
  skillNameInput.value = '';
  skillDescInput.value = '';
});

createBtn.addEventListener('click', async () => {
  const name = skillNameInput.value.trim();
  const description = skillDescInput.value.trim();

  if (!name) {
    showNotification('Please enter a skill name', 'error');
    return;
  }

  // Validate skill name: lowercase letters, numbers, and hyphens only (Claude Desktop requirement)
  if (!/^[a-z0-9-]+$/.test(name)) {
    showNotification('Skill name can only contain lowercase letters, numbers, and hyphens (e.g., my-awesome-skill)', 'error');
    return;
  }

  if (name.length > 255) {
    showNotification('Skill name is too long (max 255 characters)', 'error');
    return;
  }

  if (description.length > 500) {
    showNotification('Description is too long (max 500 characters)', 'error');
    return;
  }

  // Auto-save current skill before creating new one
  await autoSave();

  // Create template with proper escaping - use YAML formatting
  const yamlName = name.replace(/"/g, '\\"');
  const yamlDesc = (description || 'A custom Claude skill').replace(/"/g, '\\"');

  const template = `---
name: "${yamlName}"
description: "${yamlDesc}"
---
`;

  const result = await window.electronAPI.createSkill({
    name,
    description,
    content: template
  });

  if (result.success) {
    newSkillModal.classList.remove('active');
    skillNameInput.value = '';
    skillDescInput.value = '';
    const skills = await loadSkills();

    const newSkill = skills.find(s => s.name === name);
    if (newSkill) {
      await loadSkill(newSkill);
    }
  } else {
    showNotification('Failed to create skill: ' + (result.error || 'Unknown error'), 'error');
  }
});

openSkillBtn.addEventListener('click', async () => {
  await autoSave();

  const result = await window.electronAPI.openFileDialog();
  if (result.success) {
    const loadResult = await window.electronAPI.loadSkill(result.filePath);
    if (loadResult.success) {
      const importedPath = normalizePath(loadResult.path || result.filePath);
      const skills = await loadSkills();
      const importedSkill = skills.find(s => s.path === importedPath);

      if (importedSkill) {
        await loadSkill(importedSkill);
      } else {
        deactivateDragZone();
        currentSkill = {
          path: importedPath,
          name: extractSkillName(importedPath),
          description: ''
        };
        currentSkillDir = getParentDirectory(importedPath);
        currentFile = null;
        setEditorContent(loadResult.content);
        const editorElement = document.getElementById('editor');
        if (editorElement) {
          editorElement.style.display = 'flex';
        }
        fileNotEditablePlaceholder.style.display = 'none';
        emptyState.style.display = 'none';
        editorTitle.textContent = currentSkill.name;
        fileInfo.textContent = '';
        packageBtn.disabled = false;
        deleteBtn.disabled = false;
        await loadFileTree();
      }

      if (loadResult.imported) {
        showNotification(`Imported "${extractSkillName(importedPath)}" into your library`, 'success');
      }
    } else {
      showNotification('Failed to load skill: ' + (loadResult.error || 'Unknown error'), 'error');
    }
  }
});


packageBtn.addEventListener('click', async () => {
  if (!currentSkill) return;

  // Auto-save before packaging
  await autoSave();

  // Create ZIP
  const result = await window.electronAPI.createZip({
    skillPath: currentSkill.path,
    skillName: currentSkill.name
  });

  if (result.success) {
    zipPath = result.zipPath;
    dragZone.classList.add('active');
    showNotification('Package created! Drag to Claude Desktop to install', 'success');
  } else {
    showNotification('Failed to create package', 'error');
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!currentSkill) return;

  // Show confirmation modal
  deleteSkillName.textContent = currentSkill.name;
  deleteConfirmModal.classList.add('active');
});

deleteCancelBtn.addEventListener('click', () => {
  deleteConfirmModal.classList.remove('active');
});

deleteConfirmBtn.addEventListener('click', async () => {
  if (!currentSkill) return;

  // Close modal immediately
  deleteConfirmModal.classList.remove('active');

  // Delete the skill
  const result = await window.electronAPI.deleteSkill({
    skillPath: currentSkill.path
  });

  if (result.success) {
    // Clear editor state
    currentSkill = null;
    currentSkillItem = null;
    currentFileTreeContainer = null;
    setEditorContent('');
    document.getElementById('editor').style.display = 'none';
    fileNotEditablePlaceholder.style.display = 'none';
    emptyState.style.display = 'flex';
    editorTitle.textContent = 'No skill loaded';
    packageBtn.disabled = true;
    deleteBtn.disabled = true;
    deactivateDragZone();

    // Reload skills list
    await loadSkills();

    // Show success notification
    showNotification(`Skill deleted successfully`, 'success');
  } else {
    showNotification(`Failed to delete skill: ${result.error || 'Unknown error'}`, 'error');
  }
});

// Native file drag functionality using Electron API
dragZone.addEventListener('dragstart', (e) => {
  if (zipPath) {
    // Prevent default HTML5 drag behavior
    e.preventDefault();

    // Initiate native file drag operation through Electron
    // This must be called during the drag operation
    window.electronAPI.startDrag(zipPath, currentSkill.name);
  }
});

dragZone.addEventListener('dragend', (e) => {
  setTimeout(() => {
    deactivateDragZone();
    showNotification('Skill package ready to install in Claude Desktop', 'success');
  }, 100);
});

// Listen for drag errors from main process
window.electronAPI.onDragError((message) => {
  showNotification(`Drag failed: ${message}`, 'error');
});

// Functions
async function loadSkills() {
  const rawSkills = await window.electronAPI.listSkills();
  const skills = rawSkills.map(skill => ({
    ...skill,
    path: normalizePath(skill.path)
  }));
  const activeSkillPath = currentSkill ? normalizePath(currentSkill.path) : null;

  skillsList.innerHTML = '';

  skills.forEach(skill => {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.dataset.skillPath = skill.path;

    const header = document.createElement('div');
    header.className = 'skill-header';

    const headerText = document.createElement('div');
    headerText.className = 'skill-header-text';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'skill-name';
    nameDiv.textContent = skill.name;

    const descDiv = document.createElement('div');
    descDiv.className = 'skill-desc';
    descDiv.textContent = skill.description || '';

    headerText.appendChild(nameDiv);
    headerText.appendChild(descDiv);

    const toggle = document.createElement('span');
    toggle.className = 'skill-toggle';
    toggle.textContent = '▸';

    header.appendChild(headerText);
    header.appendChild(toggle);

    const details = document.createElement('div');
    details.className = 'skill-details';

    const actions = document.createElement('div');
    actions.className = 'file-tree-actions';

    const newFileButton = document.createElement('button');
    newFileButton.className = 'btn-small btn-icon';
    newFileButton.title = 'Create new file';
    newFileButton.textContent = '📄 New File';
    newFileButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!currentSkill || normalizePath(currentSkill.path) !== skill.path) {
        return;
      }
      contextMenuTarget = null;
      openCreateItemModal('file');
    });

    const newFolderButton = document.createElement('button');
    newFolderButton.className = 'btn-small btn-icon';
    newFolderButton.title = 'Create new folder';
    newFolderButton.textContent = '📁 New Folder';
    newFolderButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!currentSkill || normalizePath(currentSkill.path) !== skill.path) {
        return;
      }
      contextMenuTarget = null;
      openCreateItemModal('folder');
    });

    const uploadButton = document.createElement('button');
    uploadButton.className = 'btn-small btn-icon';
    uploadButton.title = 'Upload files';
    uploadButton.textContent = '📤 Upload';
    uploadButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!currentSkill || normalizePath(currentSkill.path) !== skill.path) {
        return;
      }
      contextMenuTarget = null;
      triggerFileUpload();
    });

    actions.appendChild(newFileButton);
    actions.appendChild(newFolderButton);
    actions.appendChild(uploadButton);

    const treeContainer = document.createElement('div');
    treeContainer.className = 'file-tree';
    treeContainer.setAttribute('data-skill-path', skill.path);

    details.appendChild(treeContainer);
    details.appendChild(actions);

    item.appendChild(header);
    item.appendChild(details);

    const selectSkill = async () => {
      if (currentSkill && normalizePath(currentSkill.path) === skill.path && item.classList.contains('expanded')) {
        return;
      }
      await loadSkill(skill, item);
    };

    header.addEventListener('click', async (event) => {
      event.stopPropagation();
      await selectSkill();
    });

    toggle.addEventListener('click', async (event) => {
      event.stopPropagation();
      await selectSkill();
    });

    skillsList.appendChild(item);
  });

  if (activeSkillPath) {
    const activeItem = findSkillItemElement(activeSkillPath);
    if (activeItem) {
      expandSkillItem(activeItem);
      await loadFileTree();
    } else {
      currentSkillItem = null;
      currentFileTreeContainer = null;
    }
  }

  return skills;
}

function findSkillItemElement(skillPath) {
  const normalized = normalizePath(skillPath);
  if (!normalized) return null;

  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return document.querySelector(`.skill-item[data-skill-path="${CSS.escape(normalized)}"]`);
  }

  const items = document.querySelectorAll('.skill-item');
  for (const item of items) {
    if (item.getAttribute('data-skill-path') === normalized) {
      return item;
    }
  }
  return null;
}

function updateSkillToggle(skillItem, expanded) {
  if (!skillItem) return;
  const toggle = skillItem.querySelector('.skill-toggle');
  if (toggle) {
    toggle.textContent = expanded ? '▾' : '▸';
  }
}

function collapseSkillItem(skillItem) {
  if (!skillItem) return;

  skillItem.classList.remove('active', 'expanded');
  updateSkillToggle(skillItem, false);

  const tree = skillItem.querySelector('.file-tree');
  if (tree) {
    tree.innerHTML = '';
  }

  if (currentSkillItem === skillItem) {
    currentSkillItem = null;
    currentFileTreeContainer = null;
  }
}

function attachRootDropHandlers(container) {
  if (!container || container.getAttribute('data-root-dnd') === 'true') {
    return;
  }

  container.addEventListener('dragover', (e) => {
    if (!e.target.closest('.file-tree-node.folder')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });

  container.addEventListener('drop', async (e) => {
    if (!e.target.closest('.file-tree-node.folder')) {
      e.preventDefault();
      const internalFilePath = e.dataTransfer.getData('application/x-skill-file');
      if (internalFilePath) {
        await moveFileToFolder(internalFilePath, '');
      }
    }
  });

  container.setAttribute('data-root-dnd', 'true');
}

function expandSkillItem(skillItem) {
  if (!skillItem) return;

  if (currentSkillItem && currentSkillItem !== skillItem) {
    collapseSkillItem(currentSkillItem);
  }

  currentSkillItem = skillItem;
  skillItem.classList.add('active', 'expanded');
  updateSkillToggle(skillItem, true);

  const tree = skillItem.querySelector('.file-tree');
  if (tree) {
    tree.innerHTML = '';
    currentFileTreeContainer = tree;
    attachRootDropHandlers(tree);
  } else {
    currentFileTreeContainer = null;
  }
}

async function loadSkill(skill, skillItem = null) {
  await autoSave();
  deactivateDragZone();

  const requestPath = normalizePath(skill.path);
  const result = await window.electronAPI.loadSkill(requestPath);
  if (result.success) {
    const resolvedPath = normalizePath(result.path || requestPath);
    currentSkill = { ...skill, path: resolvedPath };
    currentSkillDir = getParentDirectory(resolvedPath);
    currentFile = null;
    setEditorContent(result.content);
    const editorElement = document.getElementById('editor');
    if (editorElement) {
      editorElement.style.display = 'flex';
    }
    fileNotEditablePlaceholder.style.display = 'none';
    emptyState.style.display = 'none';
    editorTitle.textContent = currentSkill.name;
    fileInfo.textContent = '';
    packageBtn.disabled = false;
    deleteBtn.disabled = false;

    const resolvedItem = skillItem || findSkillItemElement(resolvedPath);
    if (resolvedItem) {
      document.querySelectorAll('.skill-item').forEach(item => {
        if (item !== resolvedItem) {
          collapseSkillItem(item);
        }
      });

      expandSkillItem(resolvedItem);
    } else {
      currentSkillItem = null;
      currentFileTreeContainer = null;
    }

    await loadFileTree();
    contextMenuTarget = null;
  } else {
    showNotification('Failed to load skill: ' + (result.error || 'Unknown error'), 'error');
  }
}

function extractSkillName(filePath) {
  const normalized = normalizePath(filePath || '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) {
    return 'Unnamed Skill';
  }
  return segments[segments.length - 2];
}

function showNotification(message, type) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 60px;
    right: 24px;
    padding: 12px 20px;
    background: ${type === 'success' ? 'var(--green)' : 'var(--orange)'};
    color: var(--light);
    border-radius: 6px;
    font-family: 'Poppins', Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 2000;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Add animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Auto-save function
async function autoSave() {
  if (!hasUnsavedChanges) {
    return;
  }

  // Clear any pending debounce timer
  if (autoSaveDebounceTimer) {
    clearTimeout(autoSaveDebounceTimer);
    autoSaveDebounceTimer = null;
  }

  const content = editor.getValue();

  // Determine what to save
  let savePath;
  if (currentFile && currentFile.editable && currentSkillDir) {
    // currentFile.path should always be relative due to getRelativePath() call
    savePath = `${currentSkillDir}/${currentFile.path}`;
  } else if (currentSkill) {
    // Save SKILL.md if no file selected or file not editable
    savePath = currentSkill.path;
  } else {
    return;
  }

  const result = await window.electronAPI.saveSkill({
    skillPath: savePath,
    content
  });

  if (result.success) {
    hasUnsavedChanges = false;
    deactivateDragZone();
  }
}

// Context menu handlers
contextMenu.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();  // Prevent bubbling to document click listener

  const item = e.target.closest('.context-menu-item');
  if (!item || !contextMenuTarget) return;

  const action = item.getAttribute('data-action');
  const nodePath = contextMenuTarget.getAttribute('data-node-path');
  const nodeType = contextMenuTarget.getAttribute('data-node-type');

  // Hide context menu immediately for delete action (before confirm dialog)
  if (action === 'delete') {
    console.log('Delete action - hiding context menu BEFORE confirm');
    hideContextMenu();
    console.log('Context menu display after hide:', contextMenu.style.display);
  }

  switch (action) {
    case 'new-file':
      openCreateItemModal('file');
      break;
    case 'new-folder':
      openCreateItemModal('folder');
      break;
    case 'upload-files':
      triggerFileUpload();
      break;
    case 'upload-folder':
      triggerFolderUpload();
      break;
    case 'rename':
      openRenameModal(nodePath, nodeType);
      break;
    case 'delete':
      openDeleteItemModal(nodePath, nodeType);
      break;
  }

  // Hide context menu after action is complete (for non-delete actions)
  if (action !== 'delete') {
    hideContextMenu();
  }
});

// Close context menu on escape or outside click
document.addEventListener('click', (e) => {
  // Don't close menu if clicking on modals or their content
  if (e.target.closest('.modal')) return;
  if (contextMenu.style.display !== 'none') {
    hideContextMenu();
    contextMenuTarget = null; // Clear target when menu is closed without action
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (deleteItemModal.classList.contains('active')) {
      closeDeleteItemModal();
      return;
    }

    if (contextMenu.style.display !== 'none') {
      hideContextMenu();
      contextMenuTarget = null; // Clear target when menu is closed without action
    }
  }
});

// Delete item modal
function openDeleteItemModal(nodePath, nodeType) {
  const isFolder = nodeType === 'folder';
  const displayPath = nodePath || '';
  const baseMessage = isFolder
    ? `This will permanently delete "${displayPath}" and all of its contents.`
    : `This will permanently delete "${displayPath}".`;

  deleteItemTitle.textContent = isFolder ? 'Delete Folder?' : 'Delete File?';
  deleteItemMessage.textContent = `${baseMessage} This action cannot be undone.`;

  deleteItemModal.setAttribute('data-node-path', nodePath);
  deleteItemModal.setAttribute('data-node-type', nodeType || '');
  deleteItemModal.classList.add('active');
  deleteItemConfirmBtn.disabled = false;

  // Clear the context menu target once we're showing the modal
  contextMenuTarget = null;

  // Defer focus so the modal is visible before moving focus
  setTimeout(() => {
    deleteItemConfirmBtn.focus();
  }, 0);
}

function closeDeleteItemModal(resetButton = true) {
  deleteItemModal.classList.remove('active');
  deleteItemModal.removeAttribute('data-node-path');
  deleteItemModal.removeAttribute('data-node-type');
  if (resetButton) {
    deleteItemConfirmBtn.disabled = false;
  }
  contextMenuTarget = null;
}

deleteItemCancelBtn.addEventListener('click', () => {
  closeDeleteItemModal();
});

deleteItemConfirmBtn.addEventListener('click', async () => {
  const nodePath = deleteItemModal.getAttribute('data-node-path');

  if (!nodePath) {
    closeDeleteItemModal();
    showNotification('No file or folder selected', 'error');
    return;
  }

  deleteItemConfirmBtn.disabled = true;
  closeDeleteItemModal(false);

  try {
    await performDeleteFileOrFolder(nodePath);
  } finally {
    deleteItemConfirmBtn.disabled = false;
  }
});

// Create item modal
function openCreateItemModal(type) {
  console.log('=== OPENING CREATE ITEM MODAL ===', type);

  // Remove any existing test listener FIRST
  if (inputTestListener) {
    itemNameInput.removeEventListener('keydown', inputTestListener);
    console.log('Removed existing test listener');
  }

  // Clear any existing interval monitor
  if (valueMonitorInterval) {
    clearInterval(valueMonitorInterval);
    console.log('Cleared existing value monitor');
  }

  // Clear the input value
  itemNameInput.value = '';

  if (type === 'file') {
    createItemTitle.textContent = 'Create New File';
    itemNameHint.textContent = 'Include file extension (e.g., .md, .py, .js)';
  } else {
    createItemTitle.textContent = 'Create New Folder';
    itemNameHint.textContent = 'Folder name';
  }
  createItemModal.setAttribute('data-create-type', type);
  createItemModal.classList.add('active');
  console.log('Modal classList:', createItemModal.classList.toString());
  console.log('Modal display:', window.getComputedStyle(createItemModal).display);
  console.log('Input disabled:', itemNameInput.disabled);
  console.log('Input readOnly:', itemNameInput.readOnly);

  // Add temporary keydown listener to test if events reach the input
  inputTestListener = (e) => {
    console.log('INPUT KEYDOWN:', e.key, 'Input value:', itemNameInput.value, 'defaultPrevented:', e.defaultPrevented);
  };
  itemNameInput.addEventListener('keydown', inputTestListener);

  // Also add input event listener to check if value changes
  const inputEventListener = (e) => {
    console.log('INPUT EVENT fired! New value:', itemNameInput.value);
  };
  itemNameInput.addEventListener('input', inputEventListener);

  // Monitor if value is being reset programmatically
  let lastValue = itemNameInput.value;
  valueMonitorInterval = setInterval(() => {
    if (itemNameInput.value !== lastValue) {
      console.log('VALUE CHANGED PROGRAMMATICALLY from', lastValue, 'to', itemNameInput.value);
      lastValue = itemNameInput.value;
    }
  }, 100);

  console.log('Added new test listener');
  console.log('itemNameInput element:', itemNameInput);
  console.log('itemNameInput id:', itemNameInput.id);

  // Check computed styles that might block input
  const computedStyle = window.getComputedStyle(itemNameInput);
  console.log('pointer-events:', computedStyle.pointerEvents);
  console.log('user-select:', computedStyle.userSelect);
  console.log('-webkit-user-modify:', computedStyle.webkitUserModify);
  console.log('contenteditable:', itemNameInput.contentEditable);

  itemNameInput.focus();
  console.log('Focused input, active element:', document.activeElement);
  console.log('Active element is input:', document.activeElement === itemNameInput);
  // Force focus again after a delay in case it was blocked
  setTimeout(() => {
    itemNameInput.focus();
    console.log('After timeout - active element:', document.activeElement);
    console.log('After timeout - active element is input:', document.activeElement === itemNameInput);
  }, 100);
}

createItemCancelBtn.addEventListener('click', () => {
  createItemModal.classList.remove('active');
  contextMenuTarget = null; // Clear target when modal is cancelled
});

createItemConfirmBtn.addEventListener('click', async () => {
  const name = itemNameInput.value.trim();
  const type = createItemModal.getAttribute('data-create-type');

  if (!name) {
    showNotification('Please enter a name', 'error');
    return;
  }

  if (!currentSkill) {
    showNotification('No skill selected', 'error');
    return;
  }

  createItemModal.classList.remove('active');

  const nodePath = contextMenuTarget ? contextMenuTarget.getAttribute('data-node-path') : '';
  const itemPath = nodePath ? `${nodePath}/${name}` : name;

  try {
    let result;
    if (type === 'file') {
      result = await window.electronAPI.createFile({
        skillPath: currentSkill.path,
        filePath: itemPath,
        content: ''
      });
    } else {
      result = await window.electronAPI.createFolder({
        skillPath: currentSkill.path,
        folderPath: itemPath
      });
    }

    if (result.success) {
      showNotification(`${type === 'file' ? 'File' : 'Folder'} created successfully`, 'success');
      deactivateDragZone();
      await loadFileTree();

      // Auto-load newly created files so user can start editing immediately
      if (type === 'file') {
        await loadFileFromTree(itemPath);
      }
    } else {
      showNotification(`Failed to create ${type}: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error(`Error creating ${type}:`, error);
    showNotification(`Error creating ${type}`, 'error');
  } finally {
    // Clear the context menu target after the operation completes
    contextMenuTarget = null;
  }
});

// Rename modal
function openRenameModal(nodePath, nodeType) {
  const currentName = nodePath.split('/').pop();
  renameInput.value = currentName;
  renameModal.classList.add('active');
  renameModal.setAttribute('data-node-path', nodePath);
  renameInput.focus();
  renameInput.select();
}

renameCancelBtn.addEventListener('click', () => {
  renameModal.classList.remove('active');
});

renameConfirmBtn.addEventListener('click', async () => {
  const newName = renameInput.value.trim();
  const nodePath = renameModal.getAttribute('data-node-path');

  if (!newName) {
    showNotification('Please enter a name', 'error');
    return;
  }

  if (!currentSkill || !nodePath) {
    showNotification('No skill or file selected', 'error');
    return;
  }

  renameModal.classList.remove('active');

  try {
    const result = await window.electronAPI.renameFileOrFolder({
      skillPath: currentSkill.path,
      oldPath: nodePath,
      newName: newName
    });

    if (result.success) {
      showNotification('Renamed successfully', 'success');
      deactivateDragZone();
      await loadFileTree();

      // If the renamed file was selected, clear the editor
      if (currentFile && currentFile.path === nodePath) {
        currentFile = null;
        setEditorContent('');
        document.getElementById('editor').style.display = 'none';
        fileNotEditablePlaceholder.style.display = 'none';
        emptyState.style.display = 'flex';
        editorTitle.textContent = currentSkill.name;
        fileInfo.textContent = '';
      }
    } else {
      showNotification(`Failed to rename: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error renaming:', error);
    showNotification('Error renaming', 'error');
  }
});

// Move file to folder
async function moveFileToFolder(filePath, targetFolderPath) {
  if (!currentSkill) return;

  // Don't allow moving into the same folder
  const currentFolder = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  if (currentFolder === targetFolderPath) {
    showNotification('File is already in this folder', 'error');
    return;
  }

  const fileName = filePath.split('/').pop();
  const newPath = targetFolderPath ? `${targetFolderPath}/${fileName}` : fileName;

  try {
    const result = await window.electronAPI.moveFile({
      skillPath: currentSkill.path,
      oldPath: filePath,
      newPath: newPath
    });

    if (result.success) {
      showNotification('File moved successfully', 'success');
      deactivateDragZone();
      await loadFileTree();

      // If the moved file was selected, update the current file path
      if (currentFile && currentFile.path === filePath) {
        currentFile.path = newPath;
        editorTitle.textContent = `${currentSkill.name} / ${currentFile.name}`;
        refreshActiveFileHighlight();
      }
    } else {
      showNotification(`Failed to move file: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error moving file:', error);
    showNotification('Error moving file', 'error');
  }
}

// Delete file or folder after confirmation via modal
async function performDeleteFileOrFolder(nodePath) {
  if (!currentSkill) {
    showNotification('No skill selected', 'error');
    return;
  }

  try {
    const result = await window.electronAPI.deleteFileOrFolder({
      skillPath: currentSkill.path,
      targetPath: nodePath
    });

    if (result.success) {
      showNotification('Deleted successfully', 'success');
      deactivateDragZone();

      const deletedPath = nodePath || '';
      const shouldClearEditor = currentFile && (
        currentFile.path === deletedPath ||
        (deletedPath && currentFile.path.startsWith(`${deletedPath}/`))
      );

      if (shouldClearEditor) {
        currentFile = null;
        setEditorContent('');
        document.getElementById('editor').style.display = 'none';
        fileNotEditablePlaceholder.style.display = 'none';
        emptyState.style.display = 'flex';
        editorTitle.textContent = `${currentSkill.name}`;
        fileInfo.textContent = '';
      }

      // Force hide upload drop zone in case it's stuck
      uploadDropZone.classList.remove('active');
      uploadDropZone.style.display = 'none';
      // Ensure context menu is hidden (should already be hidden by handler)
      console.log('Before hideContextMenu in deletion success - display:', contextMenu.style.display);
      hideContextMenu();
      console.log('After hideContextMenu in deletion success - display:', contextMenu.style.display);
      await loadFileTree();
      console.log('After loadFileTree - context menu display:', contextMenu.style.display);

      contextMenuTarget = null;
    } else {
      showNotification(`Failed to delete: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error deleting:', error);
    showNotification('Error deleting', 'error');
  }
  contextMenuTarget = null;
}

// Upload handlers
function triggerFileUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;

    if (!currentSkill) {
      showNotification('No skill selected', 'error');
      return;
    }

    // Use the context menu target folder if available
    const targetFolder = contextMenuTarget ? contextMenuTarget.getAttribute('data-node-path') : '';
    await uploadFiles(Array.from(files), targetFolder);
    contextMenuTarget = null; // Clear target after upload
  });
  input.click();
}

function triggerFolderUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.multiple = true;
  input.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;

    if (!currentSkill) {
      showNotification('No skill selected', 'error');
      return;
    }

    // Use the context menu target folder if available
    const targetFolder = contextMenuTarget ? contextMenuTarget.getAttribute('data-node-path') : '';
    await uploadFiles(Array.from(files), targetFolder, true);
    contextMenuTarget = null; // Clear target after upload
  });
  input.click();
}

async function uploadFiles(fileList, targetFolder = '', isFolder = false) {
  if (!currentSkill) return;

  const filesToUpload = [];
  for (const file of fileList) {
    const data = await file.arrayBuffer();
    filesToUpload.push({
      name: isFolder ? file.webkitRelativePath : file.name,
      data: new Uint8Array(data)
    });
  }

  try {
    const result = await window.electronAPI.uploadFiles({
      skillPath: currentSkill.path,
      files: filesToUpload,
      targetFolder: targetFolder
    });

    if (result.success) {
      showNotification(`Uploaded ${result.count} file(s)`, 'success');
      deactivateDragZone();
      loadFileTree();
    } else {
      showNotification(`Upload failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error uploading files:', error);
    showNotification('Error uploading files', 'error');
  }
}

// Drag & drop upload
const editorArea = document.querySelector('.editor-area');

editorArea.addEventListener('dragover', (e) => {
  e.preventDefault();

  // Don't show upload drop zone if dragging over a folder node
  const isDraggingOverFolder = e.target.closest('.file-tree-node.folder');
  const anyFolderHasDragOver = document.querySelector('.file-tree-node.folder.drag-over');

  if (currentSkill && !isDraggingOverFolder && !anyFolderHasDragOver) {
    uploadDropZone.classList.add('active');
    uploadDropZone.style.display = 'flex';
  } else if (isDraggingOverFolder || anyFolderHasDragOver) {
    // Hide the global drop zone when over a folder
    uploadDropZone.classList.remove('active');
    uploadDropZone.style.display = 'none';
  }
});

uploadDropZone.addEventListener('dragleave', (e) => {
  if (e.target === uploadDropZone) {
    uploadDropZone.classList.remove('active');
    uploadDropZone.style.display = 'none';
  }
});

uploadDropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadDropZone.classList.remove('active');
  uploadDropZone.style.display = 'none';

  if (!currentSkill) return;

  const items = e.dataTransfer.items;
  if (!items) return;

  const filesToUpload = [];
  const entries = Array.from(items)
    .map(item => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
    .filter(Boolean);

  const traverseFileTree = async (entry, path = '') => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
    const data = await file.arrayBuffer();
    filesToUpload.push({
      name: path ? `${path}/${file.name}` : file.name,
      data: new Uint8Array(data)
    });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      for (const childEntry of entries) {
        await traverseFileTree(childEntry, path ? `${path}/${entry.name}` : entry.name);
      }
    }
  };

  for (const entry of entries) {
    await traverseFileTree(entry);
  }

  if (filesToUpload.length > 0) {
    await uploadFiles(filesToUpload.map(f => ({
      arrayBuffer: () => Promise.resolve(f.data),
      webkitRelativePath: f.name,
      name: f.name.split('/').pop()
    })), '', true);
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  console.log('KEYDOWN EVENT:', e.key, 'Target:', e.target.tagName, e.target.id || e.target.className);

  if (
    e.key === 'Enter' &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    const confirmButton = getActiveModalConfirmButton();
    if (confirmButton && !confirmButton.disabled) {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement.closest('.modal')) {
        e.preventDefault();
        confirmButton.click();
        return;
      }
    }
  }

  // Ctrl/Cmd + P to package
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    if (currentSkill && !packageBtn.disabled) {
      packageBtn.click();
    }
  }

  // Ctrl/Cmd + N for new skill
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    newSkillBtn.click();
  }
});
