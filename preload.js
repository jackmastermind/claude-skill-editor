const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Original methods
  createSkill: (skillData) => ipcRenderer.invoke('create-skill', skillData),
  loadSkill: (skillPath) => ipcRenderer.invoke('load-skill', skillPath),
  saveSkill: (data) => ipcRenderer.invoke('save-skill', data),
  createZip: (data) => ipcRenderer.invoke('create-zip', data),
  deleteSkill: (data) => ipcRenderer.invoke('delete-skill', data),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  listSkills: () => ipcRenderer.invoke('list-skills'),
  startDrag: (zipPath, skillName) => ipcRenderer.send('start-drag', zipPath, skillName),
  onDragError: (callback) => ipcRenderer.on('drag-error', (event, message) => callback(message)),

  // New multi-file methods
  listSkillFiles: (skillPath) => ipcRenderer.invoke('list-skill-files', skillPath),
  createFile: (data) => ipcRenderer.invoke('create-file', data),
  createFolder: (data) => ipcRenderer.invoke('create-folder', data),
  deleteFileOrFolder: (data) => ipcRenderer.invoke('delete-file-or-folder', data),
  renameFileOrFolder: (data) => ipcRenderer.invoke('rename-file-or-folder', data),
  loadFile: (data) => ipcRenderer.invoke('load-file', data),
  uploadFiles: (data) => ipcRenderer.invoke('upload-files', data),
  moveFile: (data) => ipcRenderer.invoke('move-file', data)
});
