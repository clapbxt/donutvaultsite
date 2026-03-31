const DEFAULT_ORDER_ENDPOINT = "/.netlify/functions/create-order";
const STORAGE_KEY = "map_gallery_cart_v1";
const NOTICE_KEY = "map_gallery_notice_closed_v1";

// Application state
const state = {
  cart: {},
  bundle: null,
  modalMap: null,
  purchase: null,
  filters: {
    size: "all",
    availability: "all",
    author: "all",
    search: "",
  },
  maps: [], // Will be populated from Supabase
  isLoading: true,
  loadError: null,
};

const $ = (sel, root = document) => root.querySelector(sel);

function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64ToUtf8(str) {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return "";
  }
}

function normalizeEncodedBase64(value) {
  return String(value || "")
    .trim()
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .replace(/\s+/g, "");
}

function cartToString(cartObj) {
  return Object.entries(cartObj)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([id, qty]) => `${id}:${qty}`)
    .join(",");
}

function stringToCart(cartStr) {
  const cart = {};
  if (!cartStr) return cart;

  for (const pair of cartStr.split(",")) {
    const [id, qtyRaw] = pair.split(":");
    const qty = Number(qtyRaw);
    if (id && Number.isFinite(qty) && qty > 0) {
      cart[id] = qty;
    }
  }

  return cart;
}

function encodeCart(cartObj) {
  return utf8ToBase64(cartToString(cartObj));
}

function decodeCart(encoded) {
  const decoded = base64ToUtf8(normalizeEncodedBase64(encoded));
  if (!decoded) return {};
  return stringToCart(decoded);
}

function loadCart() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  return stringToCart(raw);
}

function saveCart() {
  localStorage.setItem(STORAGE_KEY, cartToString(state.cart));
  updateCartBadge();
}

function setCart(cartObj) {
  state.cart = cartObj || {};
  saveCart();
}

function mergeCart(baseCart, extraCart) {
  const merged = { ...(baseCart || {}) };

  for (const [id, qty] of Object.entries(extraCart || {})) {
    const nextQty = Number(qty || 0);
    if (nextQty > 0) {
      merged[id] = (merged[id] || 0) + nextQty;
    }
  }

  return merged;
}

/**
 * Transform Supabase map data to frontend format
 */
function transformMapData(dbMap) {
  return {
    id: dbMap.id,
    name: dbMap.name,
    author: dbMap.author,
    size: [dbMap.width, dbMap.height],
    price: dbMap.price,
    inStock: dbMap.in_stock,
    image: dbMap.image_url,
    tags: dbMap.tags || [],
    featured: dbMap.featured || false,
    date: dbMap.added_at ? new Date(dbMap.added_at).toLocaleDateString() : "Unknown",
  };
}

/**
 * Fetch maps from Supabase
 */
async function fetchMaps() {
  const client = window.SupabaseConfig?.getClient();
  
  if (!client || !window.SupabaseConfig?.isConfigured()) {
    console.warn('Supabase not configured, using fallback data');
    state.maps = window.MAP_DATA || [];
    state.isLoading = false;
    return;
  }

  try {
    state.isLoading = true;
    updateLoadingState();

    const { data, error } = await client
      .from('maps')
      .select('*')
      .order('added_at', { ascending: false });

    if (error) throw error;

    state.maps = (data || []).map(transformMapData);
    state.isLoading = false;
    state.loadError = null;
  } catch (error) {
    console.error('Error fetching maps:', error);
    state.loadError = error.message;
    state.isLoading = false;
    // Fallback to any existing data
    state.maps = window.MAP_DATA || [];
  }
  
  updateLoadingState();
}

/**
 * Get a map by ID from the loaded data
 */
function getMap(id) {
  return state.maps.find((item) => item.id === id);
}

function money(value) {
  if (value === null || value === undefined) return "Not listed";
  return new Intl.NumberFormat(undefined).format(value);
}

function sizeLabel(size) {
  return `${size[0]}x${size[1]}`;
}

/**
 * Parse size search query into [width, height] or null if not a size query
 * Supports formats: "2x1", "2 x 1", "2 by 1", "2X1", "2*1"
 */
function parseSizeQuery(query) {
  const normalized = query.toLowerCase().trim();
  
  // Match patterns like "2x1", "2 x 1", "2 by 1", "2X1", "2*1"
  const match = normalized.match(/^(\d+)\s*(?:x|by|\*)\s*(\d+)$/);
  if (match) {
    return [parseInt(match[1], 10), parseInt(match[2], 10)];
  }
  
  return null;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function getCartCount() {
  return Object.values(state.cart).reduce((sum, qty) => sum + Number(qty || 0), 0);
}

function updateCartBadge() {
  const badge = $("#cartBadge");
  if (!badge) return;
  const count = getCartCount();
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
}

function getIncomingEncodedCart() {
  const params = new URLSearchParams(location.search);

  // Try common keys first
  const value = params.get("data") || params.get("bundle");
  if (value) return value;

  // Fallback to "?=value" style
  const rawSearch = location.search;
  if (rawSearch.startsWith("?=")) return rawSearch.slice(2);

  return "";
}

/**
 * Get maps filtered by current filter state
 */
function getVisibleMaps() {
  // Check if search query is a size query
  const sizeQuery = state.filters.search ? parseSizeQuery(state.filters.search) : null;

  return state.maps.filter((map) => {
    // Availability filter
    const availabilityOk =
      state.filters.availability === "all" ||
      (state.filters.availability === "in" && map.inStock) ||
      (state.filters.availability === "out" && !map.inStock);

    // Author filter - check if the selected author is in the comma-separated list
    const authorOk =
      state.filters.author === "all" ||
      (map.author || "Unknown").split(",").some((a) => a.trim() === state.filters.author);

    // Search filter (name, author, tags, size)
    const searchOk = !state.filters.search || (() => {
      // If it's a size query, match against map size
      if (sizeQuery) {
        return map.size[0] === sizeQuery[0] && map.size[1] === sizeQuery[1];
      }
      
      const searchLower = state.filters.search.toLowerCase();
      const nameMatch = (map.name || "").toLowerCase().includes(searchLower);
      const authorMatch = (map.author || "").toLowerCase().includes(searchLower);
      const tagsMatch = (map.tags || []).some(tag => 
        tag.toLowerCase().includes(searchLower)
      );
      return nameMatch || authorMatch || tagsMatch;
    })();

    return availabilityOk && authorOk && searchOk;
  });
}

// function getOrderEndpoint() {
//   // Check if the page is loaded over HTTPS
//   const isHTTPS = window.location.protocol === "https:";
  
//   // Get the configured endpoint
//   let endpoint = document.body?.dataset.orderEndpoint || window.ORDER_ENDPOINT || DEFAULT_ORDER_ENDPOINT;
  
//   // If the page is HTTPS but endpoint is HTTP, switch to HTTPS
//   // This assumes your API server has SSL configured on the same port
//   if (isHTTPS && endpoint.startsWith("http://")) {
//     endpoint = endpoint.replace("http://", "https://");
//   }
  
//   return endpoint;
// }

function getOrderEndpoint() {
  return DEFAULT_ORDER_ENDPOINT;
}

/**
 * Update loading state UI
 */
function updateLoadingState() {
  const loadingIndicator = $("#loadingIndicator");
  const errorIndicator = $("#errorIndicator");
  const galleryContainers = document.querySelectorAll(".gallery");
  
  if (loadingIndicator) {
    loadingIndicator.classList.toggle("hidden", !state.isLoading);
  }
  
  if (errorIndicator) {
    errorIndicator.classList.toggle("hidden", !state.loadError);
    if (state.loadError) {
      errorIndicator.innerHTML = `
        <div class="error-message">
          <p>Failed to load maps: ${escapeHtml(state.loadError)}</p>
          <button class="btn btn-primary" onclick="location.reload()">Retry</button>
        </div>
      `;
    }
  }
  
  // Show/hide gallery containers based on loading state
  galleryContainers.forEach(container => {
    if (state.isLoading) {
      container.classList.add("loading");
    } else {
      container.classList.remove("loading");
    }
  });
}

function openModal(html) {
  const modal = $("#mapModal");
  const body = $("#modalBody");

  if (!modal || !body) return;

  body.innerHTML = html;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const modal = $("#mapModal");
  if (!modal) return;
  modal.classList.remove("open");
  document.body.style.overflow = "";
  state.modalMap = null;
  state.purchase = null;
}

function is1x1Map(map) {
  return map.size && map.size[0] === 1 && map.size[1] === 1;
}

function getAdditionalItemPrice(map) {
  const basePrice = map.price || 0;
  // 90% off for 1x1 maps (pay 10%), 60% off for larger maps (pay 40%)
  if (is1x1Map(map)) {
    return Math.round(basePrice * 0.10);
  }
  return Math.round(basePrice * 0.40);
}

function cartSummaryLines(cartObj = state.cart) {
  return Object.entries(cartObj)
    .map(([id, qty]) => {
      const map = getMap(id);
      if (!map) return null;
      
      const firstItemPrice = map.price || 0;
      const additionalItemPrice = getAdditionalItemPrice(map);
      const total = qty === 1 
        ? firstItemPrice 
        : firstItemPrice + (additionalItemPrice * (qty - 1));
      
      return {
        id,
        qty,
        name: map.name,
        total,
        priceLabel: money(map.price),
        firstItemPrice,
        additionalItemPrice,
        savings: qty > 1 ? (qty - 1) * (firstItemPrice - additionalItemPrice) : 0,
        discountPercent: is1x1Map(map) ? 90 : 60
      };
    })
    .filter(Boolean);
}

function renderCard(map) {
  const borderClass = map.inStock ? "map-card-in-stock" : "map-card-out-of-stock";
  return `
    <article class="map-card ${borderClass}">
      <button
        class="map-media"
        data-open-map="${escapeHtml(map.id)}"
        aria-label="Open ${escapeHtml(map.name)}"
      >
        <img src="${escapeHtml(map.image)}" alt="${escapeHtml(map.name)}" loading="lazy">
      </button>
    </article>
  `;
}

function renderGallery(target, maps) {
  if (!target) return;
  if (!maps.length) {
    target.innerHTML = `<div class="empty-state panel">No maps match these filters.</div>`;
    return;
  }
  target.innerHTML = maps.map((map) => renderCard(map)).join("");
}

function bindGalleryClicks(root = document) {
  root.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-map]");
    if (!trigger) return;
    const id = trigger.getAttribute("data-open-map");
    const map = getMap(id);
    if (map) openMapModal(map);
  });
}

function openMapModal(map) {
  state.modalMap = map;
  renderMapModalContent();
}

function renderMapModalContent() {
  const map = state.modalMap;
  if (!map) return;

  const author = map.author || "Unknown";
  const cartQty = state.cart[map.id] || 0;
  const addDisabled = !map.inStock ? "disabled" : "";

  // Price display - show "Not available" if out of stock
  const priceHtml = map.inStock
    ? `<div class="meta-item"><span>Price</span><strong>${escapeHtml(money(map.price))}</strong></div>`
    : `<div class="meta-item"><span>Price</span><strong style="color:#f87171;">Not available</strong></div>`;

  // Build actions HTML based on cart state
  let actionsHtml;
  if (cartQty > 0 && map.inStock) {
    // Show quantity selector
    actionsHtml = `
      <div class="modal-actions">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="qty-controls" style="gap:12px;">
            <button class="icon-btn" data-modal-dec="${escapeHtml(map.id)}" style="width:40px;height:40px;font-size:1.2rem;">−</button>
            <strong style="font-size:1.1rem;min-width:24px;text-align:center;">${cartQty}</strong>
            <button class="icon-btn" data-modal-inc="${escapeHtml(map.id)}" style="width:40px;height:40px;font-size:1.2rem;">+</button>
          </div>
          <span class="pill live" style="font-size:0.82rem;">In cart</span>
        </div>
        <button class="btn" data-close-modal>Close</button>
      </div>
    `;
  } else {
    actionsHtml = `
      <div class="modal-actions">
        <button class="btn btn-primary" data-add-from-modal ${addDisabled}>
          ${map.inStock ? "Add to cart" : "Archive only"}
        </button>
        <button class="btn" data-close-modal>Close</button>
      </div>
    `;
  }

  const html = `
    <div class="modal-shell modal-shell-large">
      <button class="modal-close-btn" data-close-modal aria-label="Close modal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="modal-shell-inner">
        <section class="map-stage">
          <div class="map-frame map-frame-zoom">
            <img src="${escapeHtml(map.image)}" alt="${escapeHtml(map.name)}" class="map-zoom-image">
          </div>
        </section>

        <aside class="info-panel">
          <div>
            <div class="kicker" style="margin-bottom:10px;">Map details</div>
            <h3>${escapeHtml(map.name)}</h3>
          </div>

          <div class="meta-list">
            <div class="meta-item"><span>Author</span><strong>${escapeHtml(author)}</strong></div>
            <div class="meta-item"><span>Size</span><strong>${escapeHtml(sizeLabel(map.size))}</strong></div>
            <div class="meta-item"><span>Added</span><strong>${escapeHtml(map.date || "—")}</strong></div>
            ${priceHtml}
          </div>

          ${actionsHtml}
        </aside>
      </div>
    </div>
  `;

  const modal = $("#mapModal");
  const body = $("#modalBody");
  if (!modal || !body) return;

  body.innerHTML = html;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
}

function addMapToCart(id, qty = 1) {
  state.cart[id] = (state.cart[id] || 0) + qty;
  saveCart();
  
  // Visual feedback - flash the cart badge
  const badge = $("#cartBadge");
  if (badge) {
    badge.style.transform = "scale(1.3)";
    badge.style.transition = "transform 0.2s ease";
    setTimeout(() => {
      badge.style.transform = "scale(1)";
    }, 200);
  }

  // If modal is open for this map, re-render it to show quantity selector
  if (state.modalMap && state.modalMap.id === id) {
    renderMapModalContent();
  }
}

function updateModalCartQty(id, delta) {
  const currentQty = state.cart[id] || 0;
  const newQty = currentQty + delta;

  if (newQty <= 0) {
    delete state.cart[id];
  } else {
    state.cart[id] = newQty;
  }
  saveCart();

  // Re-render modal to show updated state
  if (state.modalMap && state.modalMap.id === id) {
    renderMapModalContent();
  }
}

function renderHome() {
  const featuredGrid = $("#featuredGrid");
  const featured = state.maps.filter((map) => map.featured).slice(0, 6);
  renderGallery(featuredGrid, featured);

  const cta = $("#homeBrowseCta");
  if (cta) {
    cta.href = "browse.html";
  }
}

function renderBrowse() {
  const grid = $("#browseGrid");
  renderGallery(grid, getVisibleMaps());

  const sizeSelect = $("#sizeFilter");
  const availabilitySelect = $("#availabilityFilter");
  const authorSelect = $("#authorFilter");
  const searchInput = $("#searchInput");

  if (sizeSelect) sizeSelect.value = state.filters.size;
  if (availabilitySelect) availabilitySelect.value = state.filters.availability;
  if (authorSelect) authorSelect.value = state.filters.author;
  if (searchInput) searchInput.value = state.filters.search;

  // Split authors by comma to handle multiple authors per map
  const allAuthors = new Set();
  state.maps.forEach((m) => {
    const authorStr = m.author || "Unknown";
    authorStr.split(",").forEach((a) => allAuthors.add(a.trim()));
  });
  const authors = [...allAuthors].sort();
  if (authorSelect && authorSelect.dataset.built !== "1") {
    authorSelect.innerHTML = `<option value="all">All authors</option>` + authors.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
    authorSelect.dataset.built = "1";
  }

  // Bind filter changes
  [sizeSelect, availabilitySelect, authorSelect].forEach((el) => {
    if (!el || el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    el.addEventListener("change", () => {
      state.filters.size = sizeSelect?.value || "all";
      state.filters.availability = availabilitySelect?.value || "all";
      state.filters.author = authorSelect?.value || "all";
      renderBrowse();
    });
  });

  // Bind search input
  if (searchInput && searchInput.dataset.bound !== "1") {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", (e) => {
      state.filters.search = e.target.value;
      renderBrowse();
    });
  }

  const openId = new URLSearchParams(location.search).get("open");
  if (openId) {
    const map = getMap(openId);
    if (map) {
      history.replaceState({}, "", "browse.html");
      setTimeout(() => openMapModal(map), 50);
    }
  }
}

function renderCartPage() {
  const list = $("#cartList");
  const summaryItems = cartSummaryLines();

  if (!list) return;

  if (summaryItems.length === 0) {
    list.innerHTML = `
      <div class="empty-state panel">
        <h3 style="margin-top:0">No selections yet</h3>
        <p>Open the gallery and save a few pieces.</p>
        <a class="btn btn-primary" href="browse.html">Browse maps</a>
      </div>
    `;
    $("#cartSummary").innerHTML = `
      <div class="summary panel">
        <h3>Summary</h3>
        <div class="summary-row"><span>Items</span><strong>0</strong></div>
        <div class="summary-row"><span>Total</span><strong>0</strong></div>
        <button class="btn btn-primary" disabled>Purchase</button>
      </div>
    `;
    return;
  }

  // Build the bulk discount notice to show above the list
  const bulkNotice = `
    <div class="pricing-notice" style="margin-bottom:16px;padding:12px 14px;border-radius:14px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);font-size:0.85rem;color:rgba(251,191,36,0.9);">
      <strong>💡 Bulk discount:</strong> Extra copies are 90% off for 1x1 maps, and 60% off for larger maps.
    </div>
  `;

  list.innerHTML = bulkNotice + summaryItems
    .map((item) => {
      const map = getMap(item.id);
      return `
        <article class="cart-item">
          <img class="cart-thumb" src="${escapeHtml(map.image)}" alt="${escapeHtml(map.name)}">
          <div>
            <h4>${escapeHtml(map.name)}</h4>
            <p>${escapeHtml(sizeLabel(map.size))} · ${escapeHtml(item.priceLabel)} each</p>
          </div>
          <div class="qty-controls">
            <button class="icon-btn" data-dec="${escapeHtml(item.id)}">−</button>
            <strong>${item.qty}</strong>
            <button class="icon-btn" data-inc="${escapeHtml(item.id)}">+</button>
            <button class="icon-btn" data-remove="${escapeHtml(item.id)}" title="Remove">×</button>
          </div>
        </article>
      `;
    })
    .join("");

  const totalQty = summaryItems.reduce((sum, item) => sum + item.qty, 0);
  const total = summaryItems.reduce((sum, item) => sum + item.total, 0);

  // Generate bundle/share link for current cart
  const encodedCart = encodeCart(state.cart);
  const bundleUrl = cartLinkFor(encodedCart);

  $("#cartSummary").innerHTML = `
    <div class="summary panel">
      <h3>Summary</h3>
      <div class="summary-row"><span>Items</span><strong>${totalQty}</strong></div>
      <div class="summary-row"><span>Total</span><strong>${money(total)}</strong></div>
      <!-- Bundle/Share Link -->
      <div style="margin-top:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-radius:18px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);overflow:hidden;">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;overflow:hidden;">
            <span style="font-size:0.78rem;color:rgba(255,255,255,0.55);letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;flex-shrink:0;">SHARE</span>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:0.72rem;font-weight:600;color:#edf3fb;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,0.08);padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);max-width:280px;">${escapeHtml(bundleUrl)}</code>
          </div>
          <button class="copy-btn" data-copy-bundle-link="${escapeHtml(bundleUrl)}" title="Copy bundle link" style="flex-shrink:0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="small" style="margin-top:10px;">Purchase requests a Discord order code for this cart.</div>
      <button class="btn btn-primary" id="purchaseBtn" style="margin-top:8px;">Purchase</button>
    </div>
  `;

  const importData = new URLSearchParams(location.search).get("data");
  if (importData && !state.__importHandled) {
    state.__importHandled = true;
    const imported = decodeCart(importData);
    setCart(imported);
    renderCartPage();
  }
}

function parseBundleState() {
  const encoded = getIncomingEncodedCart();
  const decoded = base64ToUtf8(normalizeEncodedBase64(encoded));
  const rawCart = decoded ? stringToCart(decoded) : {};
  const items = cartSummaryLines(rawCart);
  const validCart = Object.fromEntries(items.map((item) => [item.id, item.qty]));
  const knownIds = new Set(items.map((item) => item.id));
  const missingIds = Object.keys(rawCart).filter((id) => !knownIds.has(id));
  const hasStructuredData = Boolean(decoded && Object.keys(rawCart).length);

  return {
    encoded,
    rawCart: validCart,
    items,
    missingIds,
    isValid: Boolean(encoded && hasStructuredData),
  };
}

function renderBundlePage() {
  const list = $("#bundleList");
  const summary = $("#bundleSummary");

  if (!list || !summary) return;

  state.bundle = parseBundleState();
  const { encoded, items, missingIds, isValid } = state.bundle;

  if (!encoded) {
    list.innerHTML = `
      <div class="empty-state panel">
        <h3 style="margin-top:0">No bundle data found</h3>
        <p>Open this page with a base64 payload, like <code>/bundles/data?=ZHJhZ29uOjEsbGFzdHN1cHBlcjoy</code>.</p>
        <a class="btn btn-primary" href="../../browse.html">Browse maps</a>
      </div>
    `;
    summary.innerHTML = `
      <div class="summary panel">
        <h3>Bundle summary</h3>
        <div class="summary-row"><span>Items</span><strong>0</strong></div>
        <div class="summary-row"><span>Total</span><strong>0</strong></div>
        <button class="btn btn-primary" disabled>Add to cart</button>
        <button class="btn" disabled>Replace cart</button>
        <button class="btn" disabled>Share bundle</button>
      </div>
    `;
    return;
  }

  if (!isValid) {
    list.innerHTML = `
      <div class="empty-state panel">
        <h3 style="margin-top:0">Bundle data could not be read</h3>
        <p>The URL payload is not a valid bundle.</p>
        <a class="btn btn-primary" href="../../browse.html">Browse maps</a>
      </div>
    `;
    summary.innerHTML = `
      <div class="summary panel">
        <h3>Bundle summary</h3>
        <div class="summary-row"><span>Items</span><strong>0</strong></div>
        <div class="summary-row"><span>Total</span><strong>0</strong></div>
        <button class="btn btn-primary" disabled>Add to cart</button>
        <button class="btn" disabled>Replace cart</button>
        <button class="btn" data-share-bundle="${escapeHtml(location.href)}">Share bundle</button>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    ${missingIds.length ? `
      <div class="panel bundle-note">
        <strong>Unavailable map IDs:</strong> ${escapeHtml(missingIds.join(", "))}
      </div>
    ` : ""}
    ${items
      .map((item) => {
        const map = getMap(item.id);
        const stockLabel = map.inStock ? "In stock" : "Archive only";
        return `
          <article class="cart-item">
            <img class="cart-thumb" src="${escapeHtml(map.image)}" alt="${escapeHtml(map.name)}">
            <div>
              <h4>${escapeHtml(map.name)}</h4>
              <p>${escapeHtml(sizeLabel(map.size))} · ${escapeHtml(item.priceLabel)} each · ${escapeHtml(stockLabel)}</p>
            </div>
            <div class="bundle-qty">
              <span class="pill ${map.inStock ? "live" : ""}">Qty ${item.qty}</span>
            </div>
          </article>
        `;
      })
      .join("")}
  `;

  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const disabledAttr = items.length ? "" : "disabled";

  summary.innerHTML = `
    <div class="summary panel">
      <h3>Bundle summary</h3>
      <div class="summary-row"><span>Items</span><strong>${totalQty}</strong></div>
      <div class="summary-row"><span>Total</span><strong>${money(total)}</strong></div>
      <div class="small" style="margin-top:10px;">This bundle page is temporary. It only updates your saved cart if you choose one of the actions below.</div>
      <button class="btn btn-primary" data-add-bundle-to-cart ${disabledAttr}>Add to cart</button>
      <button class="btn" data-replace-cart-with-bundle ${disabledAttr}>Replace cart</button>
      <button class="btn" data-share-bundle="${escapeHtml(location.href)}">Share bundle</button>
    </div>
  `;
}

async function createOrder(encodedCart) {
  const body = {
    cart: encodedCart,
  };

  let response;

  try {
    response = await fetch(getOrderEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the order API. If the site is on HTTPS, the API also needs HTTPS or a same-origin proxy.");
  }

  const text = await response.text();
  const payload = safeParseJSON(text, null);

  if (!response.ok) {
    const detail = Array.isArray(payload?.detail)
      ? payload.detail.map((item) => item.msg).filter(Boolean).join(", ")
      : payload?.detail || text;
    throw new Error(detail || `Order request failed (${response.status})`);
  }

  return payload;
}

function cartLinkFor(encoded) {
  const url = new URL("bundles/", location.href);
  url.searchParams.set("data", encoded);
  return url.toString();
}

function showPurchaseModal({ code, encoded, summary }) {
  const cartLink = cartLinkFor(encoded);
  const totalSavings = summary.reduce((sum, item) => sum + (item.savings || 0), 0);
  
  const lines = summary
    .map((item) => {
      const savingsText = item.savings > 0 
        ? `<div class="savings-badge">Saved ${money(item.savings)}</div>` 
        : '';
      return `
        <div class="summary-row">
          <div>
            <span>${escapeHtml(item.name)} × ${item.qty}</span>
            ${savingsText}
          </div>
          <strong>${escapeHtml(money(item.total))}</strong>
        </div>
      `;
    })
    .join("");

  openModal(`
    <div class="modal-shell">
      <button class="modal-close-btn" data-close-modal aria-label="Close modal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="modal-shell-inner">
        <!-- Left Panel: Cart Items -->
        <section class="purchase-info-panel">
          <div>
            <div class="kicker" style="margin-bottom:10px;">Order items</div>
            <h3 style="font-size:1.3rem;margin-bottom:4px;">Cart Summary</h3>
          </div>
          ${lines}
          ${totalSavings > 0 ? `
            <div class="summary-row" style="margin-top:10px;padding-top:10px;">
              <span style="color:#4ade80;">Total Savings</span>
              <strong style="color:#4ade80;">${money(totalSavings)}</strong>
            </div>
          ` : ''}
        </section>

        <!-- Middle Panel: Instructions -->
        <section class="purchase-instructions-panel">
          <div>
            <h3 style="font-size:1.3rem;margin-bottom:4px;">How to Complete</h3>
            <p class="small">Follow these steps to finish your order.</p>
          </div>

          <div class="instructions">
            <div class="instruction-step">
              <span class="step-number">1</span>
              <div class="step-content">
                <strong>Join Discord</strong>
                <p class="small">You need to be a member to place orders.</p>
              </div>
            </div>
            <div class="instruction-step">
              <span class="step-number">2</span>
              <div class="step-content">
                <strong>Go to #commands</strong>
                <p class="small">Navigate to the commands channel.</p>
              </div>
            </div>
            <div class="instruction-step">
              <span class="step-number">3</span>
              <div class="step-content">
                <strong>Use /order</strong>
                <p class="small">Type <code>/order ${escapeHtml(code)}</code> and press Enter.</p>
              </div>
            </div>
            <div class="instruction-step">
              <span class="step-number">4</span>
              <div class="step-content">
                <strong>Or create a ticket</strong>
                <p class="small">Send the cart/bundle URL in a ticket.</p>
              </div>
            </div>
          </div>
        </section>

        <!-- Right Panel: Code, Link, Discord -->
        <section class="purchase-info-panel">
          <div>
            <div class="kicker" style="margin-bottom:10px;">Complete order</div>
            <h3 style="font-size:1.3rem;margin-bottom:4px;">Order Code</h3>
            <p class="small">Use this code in Discord to complete your order.</p>
          </div>

          <!-- Code Block -->
          <div style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px;border-radius:18px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);">
              <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
                <span style="font-size:0.78rem;color:rgba(255,255,255,0.55);letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;">CODE</span>
                <code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:1.1rem;font-weight:600;color:#edf3fb;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,0.08);padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">${escapeHtml(code)}</code>
              </div>
              <button class="copy-btn" data-copy-code="${escapeHtml(code)}" title="Copy code">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- Cart Link Block -->
          <div style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px;border-radius:18px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);">
              <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
                <span style="font-size:0.78rem;color:rgba(255,255,255,0.55);letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;">LINK</span>
                <code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:0.7rem;font-weight:600;color:#edf3fb;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,0.08);padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">${escapeHtml(cartLink)}</code>
              </div>
              <button class="copy-btn" data-copy-link="${escapeHtml(cartLink)}" title="Copy cart link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- Discord Button -->
          <div style="margin-top:auto;">
            <a href="https://discord.com" target="_blank" rel="noreferrer" class="btn btn-primary" style="width:100%;justify-content:center;padding:14px 20px;font-size:0.95rem;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418z"/>
              </svg>
              Open Discord
            </a>
          </div>
        </section>
      </div>
    </div>
  `);

  state.purchase = { code, encoded, summary };
}

async function handlePurchase() {
  const summary = cartSummaryLines();
  if (!summary.length) return;

  const purchaseBtn = $("#purchaseBtn");
  if (purchaseBtn) {
    purchaseBtn.disabled = true;
    purchaseBtn.textContent = "Creating order…";
  }

  const encoded = encodeCart(state.cart);

  try {
    const result = await createOrder(encoded);
    if (!result || !result.code) {
      throw new Error("Missing code from server");
    }
    showPurchaseModal({
      code: result.code,
      encoded,
      summary,
    });
  } catch (err) {
    openModal(`
      <div class="modal-shell">
        <div class="modal-shell-inner" style="grid-template-columns:1fr;">
          <section class="info-panel" style="width:100%;min-width:0;">
            <div class="kicker">Order error</div>
            <h3>Could not create code</h3>
            <p class="small">${escapeHtml(err.message)}</p>
            <div class="modal-actions">
              <button class="btn btn-primary" data-try-again>Try again</button>
              <button class="btn" data-close-modal>Close</button>
            </div>
          </section>
        </div>
      </div>
    `);
  } finally {
    if (purchaseBtn) {
      purchaseBtn.disabled = false;
      purchaseBtn.textContent = "Purchase";
    }
  }
}

const NOTICE_HIDE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function isNoticeBarHidden() {
  const closedAt = localStorage.getItem(NOTICE_KEY);
  if (!closedAt) return false;
  
  const timestamp = parseInt(closedAt, 10);
  if (isNaN(timestamp)) return false;
  
  const now = Date.now();
  const elapsed = now - timestamp;
  
  // Only hidden if less than 5 minutes have passed
  return elapsed < NOTICE_HIDE_DURATION_MS;
}

function renderNoticeBar() {
  const bar = $("#noticeBar");
  if (!bar) return;
  
  const hidden = isNoticeBarHidden();
  bar.classList.toggle("hidden", hidden);
  
  // Update the notice bar content to include Discord button
  const noticeInner = bar.querySelector(".notice-inner");
  if (noticeInner) {
    noticeInner.innerHTML = `
      <div><strong>Gallery first.</strong> <a href="https://discord.com" target="_blank" rel="noreferrer">Discord</a> is only used to finish orders.</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <a href="https://discord.com" target="_blank" rel="noreferrer" class="btn" style="padding:8px 14px;font-size:0.85rem;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          Discord
        </a>
        <button class="close-chip" data-notice-close>Close</button>
      </div>
    `;
  }
}

function wireGlobalEvents() {
  document.addEventListener("click", async (event) => {
    const closeBtn = event.target.closest("[data-close-modal]");
    if (closeBtn) {
      closeModal();
      return;
    }

    const addBtn = event.target.closest("[data-add-from-modal]");
    if (addBtn && state.modalMap?.inStock) {
      addMapToCart(state.modalMap.id, 1);
      return;
    }

    const modalDec = event.target.closest("[data-modal-dec]");
    if (modalDec) {
      const id = modalDec.getAttribute("data-modal-dec");
      updateModalCartQty(id, -1);
      return;
    }

    const modalInc = event.target.closest("[data-modal-inc]");
    if (modalInc) {
      const id = modalInc.getAttribute("data-modal-inc");
      updateModalCartQty(id, 1);
      return;
    }

    const dec = event.target.closest("[data-dec]");
    if (dec) {
      const id = dec.getAttribute("data-dec");
      if (state.cart[id] > 1) state.cart[id] -= 1;
      else delete state.cart[id];
      saveCart();
      renderCartPage();
      return;
    }

    const inc = event.target.closest("[data-inc]");
    if (inc) {
      const id = inc.getAttribute("data-inc");
      addMapToCart(id, 1);
      renderCartPage();
      return;
    }

    const remove = event.target.closest("[data-remove]");
    if (remove) {
      const id = remove.getAttribute("data-remove");
      delete state.cart[id];
      saveCart();
      renderCartPage();
      return;
    }

    const purchaseBtn = event.target.closest("#purchaseBtn");
    if (purchaseBtn) {
      await handlePurchase();
      return;
    }

    const addBundle = event.target.closest("[data-add-bundle-to-cart]");
    if (addBundle && state.bundle?.items?.length) {
      setCart(mergeCart(state.cart, state.bundle.rawCart));
      addBundle.textContent = "Added";
      setTimeout(() => renderBundlePage(), 900);
      return;
    }

    const replaceWithBundle = event.target.closest("[data-replace-cart-with-bundle]");
    if (replaceWithBundle && state.bundle?.items?.length) {
      setCart({ ...state.bundle.rawCart });
      replaceWithBundle.textContent = "Cart replaced";
      setTimeout(() => renderBundlePage(), 900);
      return;
    }

    const copyCode = event.target.closest("[data-copy-code]");
    if (copyCode) {
      await navigator.clipboard.writeText(copyCode.getAttribute("data-copy-code"));
      const originalText = copyCode.textContent;
      copyCode.textContent = "Copied";
      setTimeout(() => (copyCode.textContent = originalText), 900);
      return;
    }

    const copyLink = event.target.closest("[data-copy-link]");
    if (copyLink) {
      await navigator.clipboard.writeText(copyLink.getAttribute("data-copy-link"));
      const originalText = copyLink.textContent;
      copyLink.textContent = "Copied";
      setTimeout(() => (copyLink.textContent = originalText), 900);
      return;
    }

    const copyBundleLink = event.target.closest("[data-copy-bundle-link]");
    if (copyBundleLink) {
      await navigator.clipboard.writeText(copyBundleLink.getAttribute("data-copy-bundle-link"));
      const originalText = copyBundleLink.textContent;
      copyBundleLink.textContent = "Copied";
      setTimeout(() => (copyBundleLink.textContent = originalText), 900);
      return;
    }

    const shareBundle = event.target.closest("[data-share-bundle]");
    if (shareBundle) {
      await navigator.clipboard.writeText(shareBundle.getAttribute("data-share-bundle"));
      shareBundle.textContent = "Copied";
      setTimeout(() => (shareBundle.textContent = "Share bundle"), 900);
      return;
    }

    const regenerate = event.target.closest("[data-regenerate-order]");
    if (regenerate && state.purchase) {
      await handlePurchase();
      return;
    }

    const tryAgain = event.target.closest("[data-try-again]");
    if (tryAgain) {
      await handlePurchase();
      return;
    }

    const noticeClose = event.target.closest("[data-notice-close]");
    if (noticeClose) {
      // Store timestamp so notice reappears after 5 minutes
      localStorage.setItem(NOTICE_KEY, String(Date.now()));
      renderNoticeBar();
      return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
}

async function initPage() {
  state.cart = loadCart();
  updateCartBadge();
  renderNoticeBar();
  wireGlobalEvents();
  bindGalleryClicks();

  // Fetch maps from Supabase first
  await fetchMaps();

  const page = document.body.dataset.page;

  if (page === "home") renderHome();
  if (page === "browse") renderBrowse();
  if (page === "cart") renderCartPage();
  if (page === "bundle") renderBundlePage();

  const modal = $("#mapModal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
  }
}

// Initialize when DOM is ready
window.addEventListener("DOMContentLoaded", initPage);