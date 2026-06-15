/**
 * Stella Workspace Manager
 * 파일명: stella.workspace.js
 */

const STELLA_WORKSPACE_STORAGE_KEY = "stella_workspace_v1";

function stellaCreateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stellaNow() {
  return new Date().toISOString();
}

export function loadStellaWorkspace() {
  try {
    const saved = localStorage.getItem(STELLA_WORKSPACE_STORAGE_KEY);

    if (!saved) {
      return {
        projects: [],
        chats: [],
        activeProjectId: null,
        activeChatId: null,
        createdAt: stellaNow(),
        updatedAt: stellaNow()
      };
    }

    return JSON.parse(saved);
  } catch (error) {
    console.error(error);

    return {
      projects: [],
      chats: [],
      activeProjectId: null,
      activeChatId: null,
      createdAt: stellaNow(),
      updatedAt: stellaNow()
    };
  }
}

export function saveStellaWorkspace(workspace) {
  const nextWorkspace = {
    ...workspace,
    updatedAt: stellaNow()
  };

  localStorage.setItem(
    STELLA_WORKSPACE_STORAGE_KEY,
    JSON.stringify(nextWorkspace)
  );

  return nextWorkspace;
}

export function createProject(workspace, name = "새 프로젝트") {
  const project = {
    id: stellaCreateId("project"),
    name,
    parentId: null,
    children: [],
    color: null,
    emoji: "📁",
    isFavorite: false,
    createdAt: stellaNow(),
    updatedAt: stellaNow()
  };

  return saveStellaWorkspace({
    ...workspace,
    projects: [project, ...(workspace.projects || [])],
    activeProjectId: project.id
  });
}

export function renameProject(workspace, projectId, newName) {
  const projects = (workspace.projects || []).map(project =>
    project.id === projectId
      ? {
          ...project,
          name: newName,
          updatedAt: stellaNow()
        }
      : project
  );

  return saveStellaWorkspace({
    ...workspace,
    projects
  });
}

export function copyProject(workspace, projectId) {
  const source = (workspace.projects || []).find(
    p => p.id === projectId
  );

  if (!source) return workspace;

  const copiedProject = {
    ...source,
    id: stellaCreateId("project"),
    name: `${source.name} 복사본`,
    createdAt: stellaNow(),
    updatedAt: stellaNow()
  };

  const copiedChats = (workspace.chats || [])
    .filter(chat => chat.projectId === projectId)
    .map(chat => ({
      ...chat,
      id: stellaCreateId("chat"),
      projectId: copiedProject.id,
      title: `${chat.title} 복사본`,
      createdAt: stellaNow(),
      updatedAt: stellaNow()
    }));

  return saveStellaWorkspace({
    ...workspace,
    projects: [
      copiedProject,
      ...(workspace.projects || [])
    ],
    chats: [
      ...copiedChats,
      ...(workspace.chats || [])
    ],
    activeProjectId: copiedProject.id
  });
}

export function moveProject(
  workspace,
  projectId,
  newParentId = null
) {
  const projects = (workspace.projects || []).map(project =>
    project.id === projectId
      ? {
          ...project,
          parentId: newParentId,
          updatedAt: stellaNow()
        }
      : project
  );

  return saveStellaWorkspace({
    ...workspace,
    projects
  });
}

export function deleteProject(
  workspace,
  projectId,
  options = {}
) {
  const { deleteChats = false } = options;

  const projects = (workspace.projects || []).filter(
    project => project.id !== projectId
  );

  let chats;

  if (deleteChats) {
    chats = (workspace.chats || []).filter(
      chat => chat.projectId !== projectId
    );
  } else {
    chats = (workspace.chats || []).map(chat =>
      chat.projectId === projectId
        ? {
            ...chat,
            projectId: null
          }
        : chat
    );
  }

  return saveStellaWorkspace({
    ...workspace,
    projects,
    chats
  });
}

export function toggleFavoriteProject(
  workspace,
  projectId
) {
  const projects = (workspace.projects || []).map(project =>
    project.id === projectId
      ? {
          ...project,
          isFavorite: !project.isFavorite
        }
      : project
  );

  return saveStellaWorkspace({
    ...workspace,
    projects
  });
}

export function createChat(
  workspace,
  title = "새 채팅",
  projectId = null
) {
  const chat = {
    id: stellaCreateId("chat"),
    title,
    projectId,
    messages: [],
    tags: [],
    isFavorite: false,
    createdAt: stellaNow(),
    updatedAt: stellaNow()
  };

  return saveStellaWorkspace({
    ...workspace,
    chats: [chat, ...(workspace.chats || [])],
    activeChatId: chat.id
  });
}

export function renameChat(
  workspace,
  chatId,
  newTitle
) {
  const chats = (workspace.chats || []).map(chat =>
    chat.id === chatId
      ? {
          ...chat,
          title: newTitle,
          updatedAt: stellaNow()
        }
      : chat
  );

  return saveStellaWorkspace({
    ...workspace,
    chats
  });
}

export function copyChat(
  workspace,
  chatId,
  targetProjectId = undefined
) {
  const source = (workspace.chats || []).find(
    chat => chat.id === chatId
  );

  if (!source) return workspace;

  const copiedChat = {
    ...source,
    id: stellaCreateId("chat"),
    title: `${source.title} 복사본`,
    projectId:
      targetProjectId === undefined
        ? source.projectId
        : targetProjectId,
    messages: [...(source.messages || [])],
    createdAt: stellaNow(),
    updatedAt: stellaNow()
  };

  return saveStellaWorkspace({
    ...workspace,
    chats: [
      copiedChat,
      ...(workspace.chats || [])
    ],
    activeChatId: copiedChat.id
  });
}

export function moveChat(
  workspace,
  chatId,
  targetProjectId = null
) {
  const chats = (workspace.chats || []).map(chat =>
    chat.id === chatId
      ? {
          ...chat,
          projectId: targetProjectId,
          updatedAt: stellaNow()
        }
      : chat
  );

  return saveStellaWorkspace({
    ...workspace,
    chats
  });
}

export function deleteChat(workspace, chatId) {
  const chats = (workspace.chats || []).filter(
    chat => chat.id !== chatId
  );

  return saveStellaWorkspace({
    ...workspace,
    chats
  });
}

export function toggleFavoriteChat(
  workspace,
  chatId
) {
  const chats = (workspace.chats || []).map(chat =>
    chat.id === chatId
      ? {
          ...chat,
          isFavorite: !chat.isFavorite
        }
      : chat
  );

  return saveStellaWorkspace({
    ...workspace,
    chats
  });
}

export function addMessageToChat(
  workspace,
  chatId,
  message
) {
  const chats = (workspace.chats || []).map(chat => {
    if (chat.id !== chatId) return chat;

    return {
      ...chat,
      messages: [
        ...(chat.messages || []),
        {
          id: stellaCreateId("message"),
          role: message.role || "user",
          content: message.content || "",
          createdAt: stellaNow()
        }
      ],
      updatedAt: stellaNow()
    };
  });

  return saveStellaWorkspace({
    ...workspace,
    chats
  });
}

export function getProjectChats(
  workspace,
  projectId = null
) {
  return (workspace.chats || []).filter(
    chat => chat.projectId === projectId
  );
}

export function getRootProjects(workspace) {
  return (workspace.projects || []).filter(
    project => !project.parentId
  );
}

export function getChildProjects(
  workspace,
  parentId
) {
  return (workspace.projects || []).filter(
    project => project.parentId === parentId
  );
}

export function searchWorkspace(
  workspace,
  keyword
) {
  const query = String(keyword || "")
    .trim()
    .toLowerCase();

  if (!query) {
    return {
      projects: [],
      chats: []
    };
  }

  return {
    projects: (workspace.projects || []).filter(
      project =>
        project.name
          .toLowerCase()
          .includes(query)
    ),

    chats: (workspace.chats || []).filter(chat =>
      chat.title
        .toLowerCase()
        .includes(query)
    )
  };
}

export function resetStellaWorkspace() {
  localStorage.removeItem(
    STELLA_WORKSPACE_STORAGE_KEY
  );

  return {
    projects: [],
    chats: [],
    activeProjectId: null,
    activeChatId: null,
    createdAt: stellaNow(),
    updatedAt: stellaNow()
  };
}

export default {
  loadStellaWorkspace,
  saveStellaWorkspace,

  createProject,
  renameProject,
  copyProject,
  moveProject,
  deleteProject,

  createChat,
  renameChat,
  copyChat,
  moveChat,
  deleteChat,

  toggleFavoriteProject,
  toggleFavoriteChat,

  addMessageToChat,

  getProjectChats,
  getRootProjects,
  getChildProjects,

  searchWorkspace,
  resetStellaWorkspace
};
