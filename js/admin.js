/**
 * Admin Panel JavaScript
 * Handles authentication, CRUD operations for maps
 */

const STORAGE_KEY = "admin_session_v1";
const STORAGE_BUCKET = "map-images";

// State
const adminState = {
  session: null,
  maps: [],
  editingMapId: null,
  deleteMapId: null,
};

// DOM Helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

/**
 * Get Supabase client
 */
function getSupabase() {
  return window.SupabaseConfig?.getClient();
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
  return adminState.session !== null;
}

/**
 * Update UI based on auth state
 */
function updateAuthUI() {
  const loginSection = $("#loginSection");
  const adminSection = $("#adminSection");
  const authBtn = $("#authBtn");

  if (isAuthenticated()) {
    loginSection.style.display = "none";
    adminSection.style.display = "block";
    authBtn.textContent = "Logout";
    
    const user = adminState.session.user;
    $("#userEmail").textContent = user?.email || "Admin";
    
    loadMaps();
  } else {
    loginSection.style.display = "block";
    adminSection.style.display = "none";
    authBtn.textContent = "Login";
  }
}

/**
 * Show error message
 */
function showError(element, message) {
  const el = $(element);
  if (el) {
    el.textContent = message;
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 5000);
  }
}

/**
 * Format currency
 */
function formatMoney(value) {
  return new Intl.NumberFormat(undefined).format(value);
}

/**
 * Escape HTML
 */
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

/**
 * Load all maps from Supabase
 */
async function loadMaps() {
  const client = getSupabase();
  if (!client) return;

  $("#adminLoading").style.display = "block";
  $("#mapList").innerHTML = "";
  $("#adminEmpty").style.display = "none";

  try {
    const { data, error } = await client
      .from('maps')
      .select('*')
      .order('added_at', { ascending: false });

    if (error) throw error;

    adminState.maps = data || [];
    renderMapList();
    updateStats();
  } catch (error) {
    console.error('Error loading maps:', error);
    showError("#loginError", "Failed to load maps: " + error.message);
  } finally {
    $("#adminLoading").style.display = "none";
  }
}

/**
 * Render the map list
 */
function renderMapList() {
  const list = $("#mapList");
  
  if (adminState.maps.length === 0) {
    list.innerHTML = "";
    $("#adminEmpty").style.display = "block";
    return;
  }

  $("#adminEmpty").style.display = "none";
  
  list.innerHTML = adminState.maps.map(map => `
    <div class="map-list-item" data-id="${escapeHtml(map.id)}">
      <img class="map-list-thumb" src="${escapeHtml(map.image_url)}" alt="${escapeHtml(map.name)}">
      <div class="map-list-info">
        <h4>
          ${escapeHtml(map.name)}
          ${map.featured ? '<span class="featured-badge">Featured</span>' : ''}
        </h4>
        <p>
          by ${escapeHtml(map.author)} · ${map.width}x${map.height} · 
          ${formatMoney(map.price)} · 
          <span class="stock-badge ${map.in_stock ? 'in-stock' : 'out-of-stock'}">
            ${map.in_stock ? 'In Stock' : 'Out of Stock'}
          </span>
        </p>
      </div>
      <div class="map-list-actions">
        <button class="btn" data-edit="${escapeHtml(map.id)}" style="padding:8px 14px;">Edit</button>
        <button class="btn btn-danger" data-delete="${escapeHtml(map.id)}" style="padding:8px 14px;">Delete</button>
      </div>
    </div>
  `).join("");
}

/**
 * Update statistics
 */
function updateStats() {
  const maps = adminState.maps;
  
  $("#totalMaps").textContent = maps.length;
  $("#inStockMaps").textContent = maps.filter(m => m.in_stock).length;
  $("#featuredMaps").textContent = maps.filter(m => m.featured).length;
  
  const totalValue = maps.reduce((sum, m) => sum + (m.price || 0), 0);
  $("#totalValue").textContent = formatMoney(totalValue);
}

/**
 * Open map form modal
 */
function openMapForm(map = null) {
  const modal = $("#mapFormModal");
  const form = $("#mapForm");
  
  form.reset();
  adminState.editingMapId = null;
  $("#imagePreviewContainer").style.display = "none";
  $("#mapImageFile").required = true;
  
  if (map) {
    // Edit mode
    $("#formTitle").textContent = "Edit Map";
    adminState.editingMapId = map.id;
    
    $("#mapName").value = map.name || "";
    $("#mapAuthor").value = map.author || "";
    $("#mapWidth").value = map.width || 1;
    $("#mapHeight").value = map.height || 1;
    $("#mapPrice").value = map.price || 0;
    $("#mapTags").value = (map.tags || []).join(", ");
    $("#mapInStock").checked = map.in_stock;
    $("#mapFeatured").checked = map.featured || false;
    
    // Show existing image preview (edit mode doesn't require re-upload)
    $("#mapImageFile").required = false;
    if (map.image_url) {
      $("#imagePreview").src = map.image_url;
      $("#imagePreviewContainer").style.display = "block";
    }
  } else {
    // Add mode
    $("#formTitle").textContent = "Add New Map";
    $("#mapInStock").checked = true;
  }
  
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
}

/**
 * Close map form modal
 */
function closeMapForm() {
  const modal = $("#mapFormModal");
  modal.classList.remove("open");
  document.body.style.overflow = "";
  adminState.editingMapId = null;
}

/**
 * Upload image to Supabase Storage
 */
async function uploadImage(file) {
  const client = getSupabase();
  if (!client) throw new Error("Supabase client not available");

  // Generate unique filename
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
  const filePath = `${fileName}`;

  // Upload file
  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) throw error;

  // Get public URL
  const { data: { publicUrl } } = client.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Save map (create or update)
 */
async function saveMap(event) {
  event.preventDefault();
  
  const client = getSupabase();
  if (!client) return;

  const submitBtn = $("#submitBtn");
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="loading-spinner"></span> Saving...';

  try {
    let imageUrl = null;
    const imageFile = $("#mapImageFile").files[0];

    if (imageFile) {
      // Upload new image
      submitBtn.textContent = "Uploading image...";
      imageUrl = await uploadImage(imageFile);
    } else if (adminState.editingMapId) {
      // Editing without new upload - keep existing image
      const existingMap = adminState.maps.find(m => m.id === adminState.editingMapId);
      if (existingMap) {
        imageUrl = existingMap.image_url;
      }
    }

    if (!imageUrl) {
      throw new Error("No image provided");
    }

    // Parse tags
    const tagsInput = $("#mapTags").value;
    const tags = tagsInput
      .split(",")
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const mapData = {
      name: $("#mapName").value.trim(),
      author: $("#mapAuthor").value.trim(),
      width: parseInt($("#mapWidth").value) || 1,
      height: parseInt($("#mapHeight").value) || 1,
      price: parseInt($("#mapPrice").value) || 0,
      image_url: imageUrl,
      tags: tags,
      in_stock: $("#mapInStock").checked,
      featured: $("#mapFeatured").checked,
    };

    if (adminState.editingMapId) {
      // Update existing map
      const { error } = await client
        .from('maps')
        .update(mapData)
        .eq('id', adminState.editingMapId);

      if (error) throw error;
    } else {
      // Create new map
      const { error } = await client
        .from('maps')
        .insert([mapData]);

      if (error) throw error;
    }

    closeMapForm();
    loadMaps();
  } catch (error) {
    console.error('Error saving map:', error);
    alert('Failed to save map: ' + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Map";
  }
}

/**
 * Open delete confirmation
 */
function openDeleteConfirm(mapId) {
  const map = adminState.maps.find(m => m.id === mapId);
  if (!map) return;

  adminState.deleteMapId = mapId;
  $("#deleteMapName").textContent = map.name;
  $("#deleteModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

/**
 * Close delete confirmation
 */
function closeDeleteConfirm() {
  $("#deleteModal").classList.remove("open");
  document.body.style.overflow = "";
  adminState.deleteMapId = null;
}

/**
 * Delete map
 */
async function confirmDelete() {
  if (!adminState.deleteMapId) return;

  const client = getSupabase();
  if (!client) return;

  const confirmBtn = $("#confirmDeleteBtn");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Deleting...";

  try {
    const { error } = await client
      .from('maps')
      .delete()
      .eq('id', adminState.deleteMapId);

    if (error) throw error;

    closeDeleteConfirm();
    loadMaps();
  } catch (error) {
    console.error('Error deleting map:', error);
    alert('Failed to delete map: ' + error.message);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Delete";
  }
}

/**
 * Handle login
 */
async function handleLogin(event) {
  event.preventDefault();

  const client = getSupabase();
  if (!client) return;

  const email = $("#loginEmail").value;
  const password = $("#loginPassword").value;

  const submitBtn = event.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in...";

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    adminState.session = data.session;
    updateAuthUI();
  } catch (error) {
    console.error('Login error:', error);
    showError("#loginError", "Invalid credentials: " + error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  const client = getSupabase();
  if (!client) return;

  try {
    await client.auth.signOut();
    adminState.session = null;
    adminState.maps = [];
    updateAuthUI();
  } catch (error) {
    console.error('Logout error:', error);
  }
}

/**
 * Check for existing session on load
 */
async function checkSession() {
  const client = getSupabase();
  if (!client) {
    updateAuthUI();
    return;
  }

  try {
    const { data } = await client.auth.getSession();
    adminState.session = data?.session || null;
    updateAuthUI();
  } catch (error) {
    console.error('Session check error:', error);
    updateAuthUI();
  }
}

/**
 * Show image preview when file is selected
 */
function handleImagePreview(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      $("#imagePreview").src = e.target.result;
      $("#imagePreviewContainer").style.display = "block";
    };
    reader.readAsDataURL(file);
  }
}

/**
 * Bind event listeners
 */
function bindEvents() {
  // Login form
  $("#loginForm").addEventListener("submit", handleLogin);

  // Logout button
  $("#logoutBtn").addEventListener("click", handleLogout);
  $("#authBtn").addEventListener("click", () => {
    if (isAuthenticated()) {
      handleLogout();
    } else {
      $("#loginEmail").focus();
    }
  });

  // Add map button
  $("#addMapBtn").addEventListener("click", () => openMapForm());

  // Map form submit
  $("#mapForm").addEventListener("submit", saveMap);

  // Image file preview
  $("#mapImageFile").addEventListener("change", handleImagePreview);

  // Map list actions (delegated)
  $("#mapList").addEventListener("click", (event) => {
    const editBtn = event.target.closest("[data-edit]");
    if (editBtn) {
      const mapId = editBtn.getAttribute("data-edit");
      const map = adminState.maps.find(m => m.id === mapId);
      if (map) openMapForm(map);
      return;
    }

    const deleteBtn = event.target.closest("[data-delete]");
    if (deleteBtn) {
      const mapId = deleteBtn.getAttribute("data-delete");
      openDeleteConfirm(mapId);
      return;
    }
  });

  // Delete confirmation
  $("#confirmDeleteBtn").addEventListener("click", confirmDelete);

  // Close modals
  document.addEventListener("click", (event) => {
    const closeBtn = event.target.closest("[data-close-modal]");
    if (closeBtn) {
      closeMapForm();
      closeDeleteConfirm();
      return;
    }
  });

  // Close modals on backdrop click
  $$(".modal").forEach(modal => {
    modal.addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-backdrop")) {
        closeMapForm();
        closeDeleteConfirm();
      }
    });
  });

  // Close modals on Escape
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMapForm();
      closeDeleteConfirm();
    }
  });

  // Auth state change listener
  const client = getSupabase();
  if (client) {
    client.auth.onAuthStateChange((event, session) => {
      adminState.session = session;
      updateAuthUI();
    });
  }
}

/**
 * Initialize admin panel
 */
function init() {
  bindEvents();
  checkSession();
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", init);