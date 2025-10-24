const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');
const { z } = require('zod');

let mainWindow;
const trackedTempFiles = new Set();

// Input validation schemas
const skillDataSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).default(''),
  content: z.string()
});

const saveSkillSchema = z.object({
  skillPath: z.string().min(1),
  content: z.string()
});

const createZipSchema = z.object({
  skillPath: z.string().min(1),
  skillName: z.string().min(1).max(255)
});

const deleteSkillSchema = z.object({
  skillPath: z.string().min(1)
});

const createFileSchema = z.object({
  skillPath: z.string().min(1),
  filePath: z.string().min(1),
  content: z.string().default('')
});

const createFolderSchema = z.object({
  skillPath: z.string().min(1),
  folderPath: z.string().min(1)
});

const deleteFileOrFolderSchema = z.object({
  skillPath: z.string().min(1),
  targetPath: z.string().min(1)
});

const renameFileOrFolderSchema = z.object({
  skillPath: z.string().min(1),
  oldPath: z.string().min(1),
  newName: z.string().min(1).max(255)
});

const moveFileSchema = z.object({
  skillPath: z.string().min(1),
  oldPath: z.string().min(1),
  newPath: z.string().min(1)
});

const loadFileSchema = z.object({
  filePath: z.string().min(1)
});

// File utilities
const EDITABLE_EXTENSIONS = new Set([
  '.md', '.txt', '.js', '.py', '.json', '.html', '.css', '.yaml', '.yml',
  '.sh', '.bash', '.lua', '.rb', '.go', '.rs', '.ts', '.tsx', '.jsx'
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function isEditableFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EDITABLE_EXTENSIONS.has(ext);
}

function sanitizeFileName(name) {
  // Allow letters, numbers, hyphens, underscores, dots (for extensions)
  // Preserve the extension
  const sanitized = name.replace(/[^a-zA-Z0-9._\-]/g, '');

  if (sanitized.length === 0) {
    throw new Error('Invalid filename - must contain at least one valid character');
  }

  if (sanitized.length > 255) {
    throw new Error('Filename is too long (max 255 characters)');
  }

  return sanitized;
}

function sanitizeRelativePath(relativePath) {
  if (!relativePath) {
    throw new Error('Invalid path');
  }

  const segments = relativePath.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Invalid path');
  }

  const sanitizedSegments = segments.map((segment) => {
    const sanitized = sanitizeFileName(segment);
    if (sanitized === '.' || sanitized === '..') {
      throw new Error('Invalid path segment');
    }
    return sanitized;
  });

  return sanitizedSegments.join(path.sep);
}

function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
    return 'image';
  }
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(ext)) {
    return 'document';
  }
  if (['.mp4', '.webm', '.mov', '.avi'].includes(ext)) {
    return 'video';
  }
  if (['.mp3', '.wav', '.flac'].includes(ext)) {
    return 'audio';
  }
  if (isEditableFile(filePath)) {
    return 'text';
  }
  return 'binary';
}

async function buildFileTree(dirPath, skillDirPath, relativePath = '') {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const tree = [];

  for (const entry of entries) {
    // Skip node_modules and hidden files/folders
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      const subtree = await buildFileTree(fullPath, skillDirPath, relPath);
      tree.push({
        name: entry.name,
        path: relPath,
        type: 'folder',
        children: subtree
      });
    } else {
      const stats = await fs.stat(fullPath);
      tree.push({
        name: entry.name,
        path: relPath,
        type: 'file',
        fileType: getFileType(entry.name),
        size: stats.size,
        editable: isEditableFile(entry.name)
      });
    }
  }

  return tree.sort((a, b) => {
    // Folders first, then alphabetical
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// Security utility functions
function getSkillsDir() {
  return path.join(app.getPath('userData'), 'skills');
}

function validateSkillPath(requestedPath, baseDir = getSkillsDir()) {
  // Normalize the path to resolve .. and . references
  const normalized = path.normalize(requestedPath);

  // If relative path provided, join with base directory
  const fullPath = path.isAbsolute(normalized) ? normalized : path.join(baseDir, normalized);

  // Ensure the resolved path is within the base directory
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);

  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error('Invalid path - access denied');
  }

  return resolvedPath;
}

function sanitizeSkillName(name) {
  // Allow only lowercase letters, numbers, and hyphens (Claude Desktop requirement)
  const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (sanitized.length === 0) {
    throw new Error('Skill name must contain at least one valid character (lowercase letters, numbers, or hyphens)');
  }

  if (sanitized.length > 255) {
    throw new Error('Skill name is too long (max 255 characters)');
  }

  // Disallow reserved names
  if (sanitized === 'skill' || sanitized === '') {
    throw new Error('Invalid skill name');
  }

  return sanitized;
}

// Cleanup temporary files on app exit
app.on('before-quit', async () => {
  for (const filePath of trackedTempFiles) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error(`Failed to cleanup temp file ${filePath}:`, error);
    }
  }
});

// Clean up old temp files on startup
async function cleanupOldTempFiles() {
  try {
    const tempDir = app.getPath('temp');
    const files = await fs.readdir(tempDir);
    const skillZips = files.filter(f => f.match(/^.+\.zip$/) && f.includes('skill'));

    // Clean up skill ZIPs older than 1 hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const file of skillZips) {
      const filePath = path.join(tempDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          await fs.unlink(filePath);
        }
      } catch (error) {
        // Ignore errors for individual files
      }
    }
  } catch (error) {
    console.error('Failed to cleanup old temp files:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#141413',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#141413',
      symbolColor: '#faf9f5',
      height: 40
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
  await cleanupOldTempFiles();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('create-skill', async (event, skillData) => {
  try {
    // Validate input
    const validated = skillDataSchema.parse(skillData);
    const sanitizedName = sanitizeSkillName(validated.name);

    const skillsDir = getSkillsDir();
    const skillDir = path.join(skillsDir, sanitizedName);

    // Validate the resulting path is within skills directory
    validateSkillPath(skillDir, skillsDir);

    await fs.mkdir(skillDir, { recursive: true });

    await fs.writeFile(path.join(skillDir, 'SKILL.md'), validated.content, 'utf-8');

    return { success: true, path: skillDir };
  } catch (error) {
    console.error('Error creating skill:', error);
    return { success: false, error: 'Failed to create skill' };
  }
});

ipcMain.handle('load-skill', async (event, skillPath) => {
  try {
    const skillsDir = getSkillsDir();
    await fs.mkdir(skillsDir, { recursive: true });

    try {
      const validatedPath = validateSkillPath(skillPath, skillsDir);
      if (!fsSync.existsSync(validatedPath)) {
        throw new Error('Skill file does not exist');
      }

      const content = await fs.readFile(validatedPath, 'utf-8');
      return { success: true, content, path: validatedPath };
    } catch (validationError) {
      if (!validationError || validationError.message !== 'Invalid path - access denied') {
        throw validationError;
      }
      // Allow importing external SKILL.md files
      const resolvedPath = path.resolve(skillPath);
      if (!fsSync.existsSync(resolvedPath)) {
        throw new Error('Skill file does not exist');
      }

      if (path.basename(resolvedPath).toLowerCase() !== 'skill.md') {
        throw new Error('Only SKILL.md files can be imported');
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');

      let sanitizedName;
      try {
        sanitizedName = sanitizeSkillName(path.basename(path.dirname(resolvedPath)));
      } catch (nameError) {
        sanitizedName = sanitizeSkillName(`imported-skill-${Date.now()}`);
      }

      let candidateName = sanitizedName;
      let targetDir = path.join(skillsDir, candidateName);
      let suffix = 1;
      while (fsSync.existsSync(path.join(targetDir, 'SKILL.md'))) {
        candidateName = `${sanitizedName}-${suffix}`;
        targetDir = path.join(skillsDir, candidateName);
        suffix += 1;
      }

      const targetPath = path.join(targetDir, 'SKILL.md');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(targetPath, content, 'utf-8');

      return {
        success: true,
        content,
        path: targetPath,
        imported: true,
        skillName: candidateName
      };
    }
  } catch (error) {
    console.error('Error loading skill:', error);
    return { success: false, error: error.message || 'Failed to load skill' };
  }
});

ipcMain.handle('save-skill', async (event, data) => {
  try {
    // Validate input
    const validated = saveSkillSchema.parse(data);

    // Validate path is within skills directory
    const validatedPath = validateSkillPath(validated.skillPath);

    await fs.writeFile(validatedPath, validated.content, 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error saving skill:', error);
    return { success: false, error: 'Failed to save skill' };
  }
});

ipcMain.handle('create-zip', async (event, data) => {
  return new Promise((resolve, reject) => {
    try {
      // Validate input
      const validated = createZipSchema.parse(data);

      // Validate path is within skills directory
      const validatedPath = validateSkillPath(validated.skillPath);
      const skillDir = path.dirname(validatedPath);

      // Ensure skill directory exists and is readable
      if (!fsSync.existsSync(skillDir)) {
        throw new Error('Skill directory does not exist');
      }

      // Sanitize filename for ZIP
      const sanitizedName = validated.skillName.replace(/[^a-zA-Z0-9\-_.]/g, '');
      const zipPath = path.join(app.getPath('temp'), `skill-${sanitizedName}-${Date.now()}.zip`);

      // Track temp file for cleanup
      trackedTempFiles.add(zipPath);

      const output = fsSync.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve({ success: true, zipPath });
      });

      output.on('error', (err) => {
        trackedTempFiles.delete(zipPath);
        reject({ success: false, error: 'Failed to create ZIP' });
      });

      archive.on('error', (err) => {
        trackedTempFiles.delete(zipPath);
        reject({ success: false, error: 'Failed to create ZIP' });
      });

      archive.pipe(output);
      archive.directory(skillDir, false);
      archive.finalize();
    } catch (error) {
      console.error('Error creating ZIP:', error);
      reject({ success: false, error: 'Failed to create ZIP' });
    }
  });
});

// Handle native file drag operation
ipcMain.on('start-drag', (event, zipPath, skillName) => {
  try {
    // Verify the file exists
    if (!fsSync.existsSync(zipPath)) {
      console.error('ZIP file does not exist:', zipPath);
      event.sender.send('drag-error', 'ZIP file not found');
      return;
    }

    // Resolve an icon for the drag payload
    const candidateIconPaths = [
      path.join(app.getAppPath(), 'icon.png'),
      path.join(__dirname, 'icon.png'),
      path.join(__dirname, 'node_modules/app-builder-lib/templates/icons/electron-linux/64x64.png')
    ];

    let dragIcon = null;
    for (const iconPath of candidateIconPaths) {
      if (!iconPath || !fsSync.existsSync(iconPath)) {
        continue;
      }
      const image = nativeImage.createFromPath(iconPath);
      if (image && !image.isEmpty()) {
        dragIcon = image;
        break;
      }
    }

    if (!dragIcon) {
      // Fallback to a 1x1 transparent pixel so Linux has a valid icon
      const transparentPixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWNgYGD4DwABBAEA6drdzQAAAABJRU5ErkJggg==',
        'base64'
      );
      dragIcon = nativeImage.createFromBuffer(transparentPixel);
    } else {
      const { width, height } = dragIcon.getSize();
      const MAX_DRAG_ICON_DIM = 48;
      if (width > MAX_DRAG_ICON_DIM || height > MAX_DRAG_ICON_DIM) {
        dragIcon = dragIcon.resize({ width: MAX_DRAG_ICON_DIM, height: MAX_DRAG_ICON_DIM, quality: 'best' });
      }
    }

    // Start the native drag operation
    event.sender.startDrag({
      file: zipPath,
      icon: dragIcon
    });
  } catch (error) {
    console.error('Error starting drag:', error);
    event.sender.send('drag-error', 'Failed to start drag operation');
  }
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Skill Files', extensions: ['md'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, filePath: result.filePaths[0] };
  }
  
  return { success: false };
});

ipcMain.handle('list-skills', async () => {
  const skillsDir = getSkillsDir();

  try {
    await fs.mkdir(skillsDir, { recursive: true });
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });

    const skillList = await Promise.all(
      entries
        .filter(entry => entry.isDirectory())
        .map(async (entry) => {
          const skillName = entry.name;
          const skillPath = path.join(skillsDir, skillName, 'SKILL.md');

          try {
            // Validate skill name
            sanitizeSkillName(skillName);

            // Validate path is within skills directory
            validateSkillPath(skillPath, skillsDir);

            const content = await fs.readFile(skillPath, 'utf-8');

            // Extract description from YAML frontmatter
            const descMatch = content.match(/^description:\s*(.+?)(?:\n|$)/m);
            const description = descMatch ? descMatch[1].trim() : 'No description';

            return {
              name: skillName,
              path: skillPath,
              description: description.substring(0, 200) // Limit description length
            };
          } catch (error) {
            console.error(`Error loading skill ${skillName}:`, error);
            return null;
          }
        })
    );

    return skillList.filter(Boolean);
  } catch (error) {
    console.error('Error listing skills:', error);
    return [];
  }
});

ipcMain.handle('delete-skill', async (event, data) => {
  try {
    // Validate input
    const validated = deleteSkillSchema.parse(data);

    // Validate path is within skills directory
    const validatedPath = validateSkillPath(validated.skillPath);

    // Get the skill directory (parent of SKILL.md file)
    const skillDir = path.dirname(validatedPath);

    // Ensure skill directory exists
    if (!fsSync.existsSync(skillDir)) {
      return { success: false, error: 'Skill directory does not exist' };
    }

    // Delete the entire skill directory
    await fs.rm(skillDir, { recursive: true, force: true });

    return { success: true };
  } catch (error) {
    console.error('Error deleting skill:', error);
    return { success: false, error: 'Failed to delete skill' };
  }
});

// List files in a skill directory with tree structure
ipcMain.handle('list-skill-files', async (event, skillPath) => {
  try {
    // Validate the skill path first
    const validatedPath = validateSkillPath(skillPath);
    const skillDir = path.dirname(validatedPath);

    if (!fsSync.existsSync(skillDir)) {
      return { success: false, error: 'Skill directory does not exist' };
    }

    const fileTree = await buildFileTree(skillDir, skillDir);
    return { success: true, files: fileTree };
  } catch (error) {
    console.error('Error listing skill files:', error);
    return { success: false, error: 'Failed to list skill files' };
  }
});

// Create a new file in a skill
ipcMain.handle('create-file', async (event, data) => {
  try {
    // Validate input
    const validated = createFileSchema.parse(data);

    // Validate skill path
    const skillDirPath = validateSkillPath(validated.skillPath);
    const skillDir = path.dirname(skillDirPath);

    // Build the full file path
    const sanitizedFileName = sanitizeFileName(path.basename(validated.filePath));
    const fileDir = path.dirname(validated.filePath);
    const fullPath = path.join(skillDir, fileDir, sanitizedFileName);

    // Validate the resulting path is within skill directory
    const validatedFilePath = validateSkillPath(fullPath, skillDir);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(validatedFilePath), { recursive: true });

    // Write the file
    await fs.writeFile(validatedFilePath, validated.content, 'utf-8');

    return { success: true, path: validated.filePath };
  } catch (error) {
    console.error('Error creating file:', error);
    return { success: false, error: 'Failed to create file' };
  }
});

// Create a new folder in a skill
ipcMain.handle('create-folder', async (event, data) => {
  try {
    // Validate input
    const validated = createFolderSchema.parse(data);

    // Validate skill path
    const skillDirPath = validateSkillPath(validated.skillPath);
    const skillDir = path.dirname(skillDirPath);

    // Build the full folder path
    const sanitizedFolderName = sanitizeFileName(path.basename(validated.folderPath));
    const folderDir = path.dirname(validated.folderPath);
    const fullPath = path.join(skillDir, folderDir, sanitizedFolderName);

    // Validate the resulting path is within skill directory
    const validatedFolderPath = validateSkillPath(fullPath, skillDir);

    // Create the folder
    await fs.mkdir(validatedFolderPath, { recursive: true });

    return { success: true, path: validated.folderPath };
  } catch (error) {
    console.error('Error creating folder:', error);
    return { success: false, error: 'Failed to create folder' };
  }
});

// Delete a file or folder
ipcMain.handle('delete-file-or-folder', async (event, data) => {
  try {
    // Validate input
    const validated = deleteFileOrFolderSchema.parse(data);

    // Validate skill path
    const skillDirPath = validateSkillPath(validated.skillPath);
    const skillDir = path.dirname(skillDirPath);

    // Build the full path
    const fullPath = path.join(skillDir, validated.targetPath);

    // Validate the resulting path is within skill directory
    const validatedPath = validateSkillPath(fullPath, skillDir);

    // Prevent deletion of SKILL.md
    if (path.basename(validatedPath) === 'SKILL.md') {
      return { success: false, error: 'Cannot delete SKILL.md - it is required' };
    }

    // Check if exists
    if (!fsSync.existsSync(validatedPath)) {
      return { success: false, error: 'File or folder does not exist' };
    }

    // Delete
    await fs.rm(validatedPath, { recursive: true, force: true });

    return { success: true };
  } catch (error) {
    console.error('Error deleting file or folder:', error);
    return { success: false, error: 'Failed to delete file or folder' };
  }
});

// Rename a file or folder
ipcMain.handle('rename-file-or-folder', async (event, data) => {
  try {
    // Validate input
    const validated = renameFileOrFolderSchema.parse(data);

    // Validate skill path
    const skillDirPath = validateSkillPath(validated.skillPath);
    const skillDir = path.dirname(skillDirPath);

    // Build the full paths
    const oldFullPath = path.join(skillDir, validated.oldPath);
    const validatedOldPath = validateSkillPath(oldFullPath, skillDir);

    // Sanitize new name
    const sanitizedNewName = sanitizeFileName(validated.newName);

    // Prevent renaming SKILL.md
    if (path.basename(validatedOldPath) === 'SKILL.md') {
      return { success: false, error: 'Cannot rename SKILL.md' };
    }

    // Build new path (same directory, new name)
    const newFullPath = path.join(path.dirname(validatedOldPath), sanitizedNewName);
    const validatedNewPath = validateSkillPath(newFullPath, skillDir);

    // Check if old exists
    if (!fsSync.existsSync(validatedOldPath)) {
      return { success: false, error: 'File or folder does not exist' };
    }

    // Check if new path already exists
    if (fsSync.existsSync(validatedNewPath)) {
      return { success: false, error: 'A file or folder with that name already exists' };
    }

    // Rename
    await fs.rename(validatedOldPath, validatedNewPath);

    return { success: true };
  } catch (error) {
    console.error('Error renaming file or folder:', error);
    return { success: false, error: 'Failed to rename file or folder' };
  }
});

// Load a file with metadata
ipcMain.handle('load-file', async (event, data) => {
  try {
    // Validate input
    const validated = loadFileSchema.parse(data);

    // Validate path is within skills directory
    const validatedPath = validateSkillPath(validated.filePath);

    // Check if exists
    if (!fsSync.existsSync(validatedPath)) {
      return { success: false, error: 'File does not exist' };
    }

    // Get file stats
    const stats = await fs.stat(validatedPath);

    // Check file size
    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: true,
        content: '',
        metadata: {
          name: path.basename(validatedPath),
          path: validated.filePath,
          type: getFileType(validated.filePath),
          size: stats.size,
          editable: false,
          tooBig: true,
          error: 'File is too large to edit (max 10MB)'
        }
      };
    }

    // Check if editable
    const isEditable = isEditableFile(validatedPath);

    if (isEditable) {
      const content = await fs.readFile(validatedPath, 'utf-8');
      return {
        success: true,
        content,
        metadata: {
          name: path.basename(validatedPath),
          path: validated.filePath,
          type: getFileType(validated.filePath),
          size: stats.size,
          editable: true
        }
      };
    } else {
      return {
        success: true,
        content: '',
        metadata: {
          name: path.basename(validatedPath),
          path: validated.filePath,
          type: getFileType(validated.filePath),
          size: stats.size,
          editable: false
        }
      };
    }
  } catch (error) {
    console.error('Error loading file:', error);
    return { success: false, error: 'Failed to load file' };
  }
});

// Upload files (supporting multiple files and folder structure preservation)
ipcMain.handle('upload-files', async (event, data) => {
  try {
    const { skillPath, files, targetFolder = '' } = data;

    // Validate skill path
    const skillDirPath = validateSkillPath(skillPath);
    const skillDir = path.dirname(skillDirPath);

    // Build target directory
    const targetPath = targetFolder ? path.join(skillDir, targetFolder) : skillDir;
    const validatedTargetPath = validateSkillPath(targetPath, skillDir);

    // Ensure target directory exists
    await fs.mkdir(validatedTargetPath, { recursive: true });

    const uploadedFiles = [];

    // Process each file
    for (const file of files) {
      try {
        const sanitizedRelative = sanitizeRelativePath(file.name);
        const destinationPath = path.join(validatedTargetPath, sanitizedRelative);
        const validatedDestination = validateSkillPath(destinationPath, skillDir);

        await fs.mkdir(path.dirname(validatedDestination), { recursive: true });
        await fs.writeFile(validatedDestination, file.data);
        uploadedFiles.push(sanitizedRelative.split(path.sep).join('/'));
      } catch (fileError) {
        console.error(`Error uploading file ${file.name}:`, fileError);
      }
    }

    return { success: true, uploadedFiles, count: uploadedFiles.length };
  } catch (error) {
    console.error('Error uploading files:', error);
    return { success: false, error: 'Failed to upload files' };
  }
});

// Move file to a different folder
ipcMain.handle('move-file', async (event, data) => {
  try {
    // Validate input
    const validated = moveFileSchema.parse(data);

    // Validate skill path
    const skillDirPath = validateSkillPath(validated.skillPath);
    const skillDir = path.dirname(skillDirPath);

    // Build full paths
    const oldFullPath = path.join(skillDir, validated.oldPath);
    const newFullPath = path.join(skillDir, validated.newPath);

    // Validate both paths are within skill directory
    const validatedOldPath = validateSkillPath(oldFullPath, skillDir);
    const validatedNewPath = validateSkillPath(newFullPath, skillDir);

    // Prevent moving SKILL.md
    if (path.basename(validatedOldPath) === 'SKILL.md') {
      return { success: false, error: 'Cannot move SKILL.md' };
    }

    // Check if old path exists
    if (!fsSync.existsSync(validatedOldPath)) {
      return { success: false, error: 'Source file does not exist' };
    }

    // Check if new path already exists
    if (fsSync.existsSync(validatedNewPath)) {
      return { success: false, error: 'A file with that name already exists in the target folder' };
    }

    // Ensure target directory exists
    const targetDir = path.dirname(validatedNewPath);
    await fs.mkdir(targetDir, { recursive: true });

    // Move the file
    await fs.rename(validatedOldPath, validatedNewPath);

    return { success: true };
  } catch (error) {
    console.error('Error moving file:', error);
    return { success: false, error: 'Failed to move file' };
  }
});
