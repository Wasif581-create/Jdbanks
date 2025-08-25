// Module script: E‑Commerce + Admin (Firebase Auth/Firestore/Storage)
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// Reuse Firebase app initialized in index.html
const app = window.firebaseApp;
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// JD BANKS E‑Commerce Frontend (Vanilla JS)

// Navigation
function navigateTo(hash) {
    const id = hash.startsWith('#') ? hash.substring(1) : hash;
    const el = document.getElementById(id);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', `#${id}`);
    }
}
// Expose for inline onclick in index.html (module scripts are scoped by default)
window.navigateTo = navigateTo;

function setupNav() {
    document.querySelectorAll('.nav-link').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            navigateTo(a.getAttribute('href'));
        });
    });
}

// Mobile navbar: hamburger toggle
function setupMobileNav() {
    const btn = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');
    if (!btn || !nav) return;

    const list = nav.querySelector('ul');
    const items = Array.from(nav.querySelectorAll('li'));

    // Ensure initial clean state
    nav.style.overflow = '';
    list && (list.style.marginTop = '');

    const openWithAnim = () => {
        // Make it visible first
        if (!nav.classList.contains('open')) nav.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');

        // Measure target height
        const target = nav.scrollHeight;

        try {
            if (window.motion && motion.animate) {
                nav.style.overflow = 'hidden';
                // Start from collapsed state
                nav.style.height = '0px';
                nav.style.opacity = '0';
                // Container expand + fade
                const expand = motion.animate(
                    nav,
                    {
                        height: [0, target],
                        opacity: [0, 1]
                    },
                    { duration: 0.32, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
                );
                // Stagger items
                items.forEach((li, i) => {
                    li.style.opacity = '0';
                    li.style.transform = 'translateY(-8px)';
                    motion.animate(
                        li,
                        { opacity: [0, 1], transform: ['translateY(-8px)', 'translateY(0)'] },
                        { duration: 0.24, delay: 0.045 * i, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
                    );
                });
                expand.finished.finally(() => {
                    nav.style.height = '';
                    nav.style.overflow = '';
                });
            }
        } catch {
            // Fallback: just show
            nav.style.height = '';
            nav.style.opacity = '';
            nav.style.overflow = '';
        }
    };

    const closeWithAnim = () => {
        try {
            if (window.motion && motion.animate) {
                const current = nav.getBoundingClientRect().height || nav.scrollHeight;
                nav.style.overflow = 'hidden';
                const collapse = motion.animate(
                    nav,
                    {
                        height: [current, 0],
                        opacity: [1, 0]
                    },
                    { duration: 0.22, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
                );
                collapse.finished.finally(() => {
                    nav.classList.remove('open');
                    btn.setAttribute('aria-expanded', 'false');
                    // Reset inline styles
                    nav.style.height = '';
                    nav.style.opacity = '';
                    nav.style.overflow = '';
                    // Reset items inline transforms
                    items.forEach(li => { li.style.opacity = ''; li.style.transform = ''; });
                });
            } else {
                nav.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            }
        } catch {
            nav.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
    };

    btn.addEventListener('click', () => {
        const isOpen = nav.classList.contains('open');
        if (isOpen) {
            closeWithAnim();
        } else {
            openWithAnim();
            // Button micro-interaction
            try { if (window.motion && motion.animate) motion.animate(btn, { scale: [1, 0.95, 1] }, { duration: 0.18 }); } catch {}
        }
    });

    // Close menu when a link is clicked (useful on mobile)
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeWithAnim));

    // On resize to desktop, ensure menu is closed and aria reset
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            nav.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            // Clear inline styles for safety
            nav.style.height = '';
            nav.style.opacity = '';
            nav.style.overflow = '';
            items.forEach(li => { li.style.opacity = ''; li.style.transform = ''; });
        }
    });
}

// Firestore-driven catalog
let catalog = [];

const categoriesByGender = {
    women: ['All', 'Shoes', 'Dresses', 'Accessories'],
    men: ['All', 'Shoes', 'Apparel', 'Accessories'],
    juniors: ['All', 'Shoes', 'Apparel', 'Accessories']
};

// EU Size ranges for different categories
const sizesByCategory = {
    'Shoes': {
        women: ['35', '36', '37', '38', '39', '40', '41', '42'],
        men: ['39', '40', '41', '42', '43', '44', '45', '46', '47'],
        juniors: ['28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38']
    },
    'Dresses': {
        women: ['Small', 'Medium', 'Large', 'XL']
    },
    'Apparel': {
        men: ['Small', 'Medium', 'Large', 'XL', 'XXL'],
        juniors: ['1 Year', '2 Years', '3 Years', '4 Years', '5 Years', '6 Years', '7 Years', '8 Years']
    }
};

const selected = { women: 'All', men: 'All', juniors: 'All' };

// Cart State
let cart = [];
function loadCart() {
    try {
        cart = JSON.parse(localStorage.getItem('jdb_cart') || '[]');
    } catch { cart = []; }
}
function saveCart() { localStorage.setItem('jdb_cart', JSON.stringify(cart)); }

function updateCartCount() {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    const el = document.getElementById('cart-count');
    if (el) el.textContent = count;
}

function showToast(message) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
}

function addToCart(productId, sourceBtn, selectedSize = null) {
    const item = catalog.find(p => p.id === productId);
    if (!item) return;
    
    // Check if this product requires size selection
    const requiresSize = (item.category === 'Shoes') || 
                        (item.category === 'Dresses' && item.gender === 'women') ||
                        (item.category === 'Apparel' && (item.gender === 'juniors' || item.gender === 'men'));
                        
    if (requiresSize && !selectedSize) {
        // Determine appropriate message based on category
        let sizeType = 'size';
        if (item.category === 'Shoes') {
            sizeType = 'EU size';
        } else if (item.category === 'Apparel' && item.gender === 'juniors') {
            sizeType = 'age';
        }
        showToast(`Please select a ${sizeType}`);
        return;
    }
    
    // Create unique identifier for cart item (product + size combination)
    const cartItemId = requiresSize ? `${productId}_${selectedSize}` : productId;
    
    const existing = cart.find(c => c.cartItemId === cartItemId);
    if (existing) {
        existing.qty += 1;
    } else {
        const cartItem = { ...item, qty: 1, cartItemId };
        if (requiresSize) {
            cartItem.selectedSize = selectedSize;
        }
        cart.push(cartItem);
    }
    
    saveCart();
    updateCartCount();
    renderCartTotals();
    
    // Create appropriate success message
    let successMessage = 'Added to cart';
    if (requiresSize) {
        if (item.category === 'Shoes') {
            successMessage = `Added to cart (Size: EU ${selectedSize})`;
        } else if (item.category === 'Dresses') {
            successMessage = `Added to cart (Size: ${selectedSize})`;
        } else if (item.category === 'Apparel' && item.gender === 'juniors') {
            successMessage = `Added to cart (Age: ${selectedSize})`;
        } else if (item.category === 'Apparel' && item.gender === 'men') {
            successMessage = `Added to cart (Size: ${selectedSize})`;
        }
    }
    showToast(successMessage);
    
    if (sourceBtn) {
        const original = sourceBtn.textContent;
        sourceBtn.textContent = 'Added';
        sourceBtn.disabled = true;
        setTimeout(() => { sourceBtn.textContent = original; sourceBtn.disabled = false; }, 1200);
    }
}

function removeFromCart(cartItemId) {
    cart = cart.filter(i => i.cartItemId !== cartItemId);
    saveCart();
    updateCartCount();
    renderCartTotals();
}

function changeQty(cartItemId, qty) {
    const item = cart.find(i => i.cartItemId === cartItemId);
    if (!item) return;
    const n = Math.max(1, Number(qty) || 1);
    item.qty = n;
    saveCart();
    updateCartCount();
    renderCartTotals();
}

// Rendering Helpers
function chip(label, active) {
    const div = document.createElement('div');
    div.className = 'category-chip' + (active ? ' active' : '');
    div.textContent = label;
    return div;
}

function renderCategoryChips(containerId, gender) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.innerHTML = '';
    categoriesByGender[gender].forEach(cat => {
        const c = chip(cat, selected[gender] === cat);
        c.addEventListener('click', () => {
            selected[gender] = cat;
            renderCategoryChips(containerId, gender);
            renderProducts(`${gender}-products`, gender);
            const titleEl = document.getElementById(`${gender}-listing-title`);
            if (titleEl) titleEl.textContent = cat === 'All' ? 'Featured Products' : `${cat}`;
        });
        wrap.appendChild(c);
    });
}

function formatPrice(n) { return `PKR ${Number(n).toFixed(2)}`; }

function productCard(p) {
    const card = document.createElement('div');
    card.className = 'product-card';
    
    // Check if this product needs size selection
    const requiresSize = (p.category === 'Shoes') || 
                        (p.category === 'Dresses' && p.gender === 'women') ||
                        (p.category === 'Apparel' && (p.gender === 'juniors' || p.gender === 'men'));
    
    const availableSizes = requiresSize ? (sizesByCategory[p.category]?.[p.gender] || []) : [];
    
    // Determine size label based on category
    let sizeLabel = 'Size:';
    if (p.category === 'Shoes') {
        sizeLabel = 'EU Size:';
    } else if (p.category === 'Dresses') {
        sizeLabel = 'Size:';
    } else if (p.category === 'Apparel' && p.gender === 'juniors') {
        sizeLabel = 'Age:';
    } else if (p.category === 'Apparel' && p.gender === 'men') {
        sizeLabel = 'Size:';
    }
    
    // Create size selection dropdown
    const sizeSelectHtml = requiresSize && availableSizes.length > 0 ? `
        <div class="size-selection">
            <label for="size-${p.id}">${sizeLabel}</label>
            <select id="size-${p.id}" class="size-dropdown">
                <option value="">Select ${sizeLabel.replace(':', '')}</option>
                ${availableSizes.map(size => `<option value="${size}">${size}</option>`).join('')}
            </select>
        </div>
    ` : '';
    
    card.innerHTML = `
        <img class="product-image" src="${p.img}" alt="${p.title}">
        <div class="product-info">
            <div class="product-title">${p.title}</div>
            ${sizeSelectHtml}
            <div class="price-row">
                <div class="price">${formatPrice(Number(p.price))}</div>
                <button class="add-to-cart">Add</button>
            </div>
            <div class="actions-row">
                <button class="secondary-button more-pictures">More Pictures</button>
            </div>
        </div>
    `;
    
    const btn = card.querySelector('.add-to-cart');
    btn.addEventListener('click', () => {
        if (requiresSize) {
            const sizeSelect = card.querySelector(`#size-${p.id}`);
            const selectedSize = sizeSelect ? sizeSelect.value : null;
            addToCart(p.id, btn, selectedSize);
        } else {
            addToCart(p.id, btn);
        }
    });
    
    // More Pictures button
    const moreBtn = card.querySelector('.more-pictures');
    if (moreBtn) {
        moreBtn.addEventListener('click', () => {
            const extras = Array.isArray(p.images) ? p.images.slice(0,3) : [];
            const images = [p.img, ...extras].filter(Boolean);
            openImageModal(images, 0);
        });
    }
    
    return card;
}

function animateProductGrid(grid) {
    try {
        const cards = grid.querySelectorAll('.product-card');
        cards.forEach((card, i) => {
            // initial state
            card.style.opacity = 0;
            card.style.transform = 'translateY(16px)';
            if (window.motion && motion.animate) {
                motion.animate(card, { opacity: [0, 1], transform: ['translateY(16px)', 'translateY(0)'] }, { duration: 0.4, delay: i * 0.06, easing: 'ease-out' });
                // hover micro interaction
                card.addEventListener('mouseenter', () => motion.animate(card, { scale: 1.02 }, { duration: 0.2 }));
                card.addEventListener('mouseleave', () => motion.animate(card, { scale: 1.0 }, { duration: 0.2 }));
            } else {
                // Fallback CSS transition
                requestAnimationFrame(() => {
                    card.style.transition = 'opacity .4s ease, transform .4s ease';
                    card.style.opacity = 1;
                    card.style.transform = 'translateY(0)';
                });
            }
        });
    } catch {}
}

function renderProducts(containerId, gender) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = '';
    const cat = selected[gender];
    const list = catalog.filter(p => p.gender === gender && (cat === 'All' || (p.category || '') === cat));
    list.forEach(p => grid.appendChild(productCard(p)));
    // Animate after DOM nodes are in place
    animateProductGrid(grid);
}

// Cart Rendering
function renderCart() {
    const tbody = document.getElementById('cart-items');
    if (!tbody) return;
    tbody.innerHTML = '';
    cart.forEach(item => {
        const tr = document.createElement('tr');
        const lineTotal = Number(item.price) * item.qty;
        
        // Display appropriate size information based on category
        let sizeInfo = '';
        if (item.selectedSize) {
            if (item.category === 'Shoes') {
                sizeInfo = ` (EU Size: ${item.selectedSize})`;
            } else if (item.category === 'Dresses') {
                sizeInfo = ` (Size: ${item.selectedSize})`;
            } else if (item.category === 'Apparel' && item.gender === 'juniors') {
                sizeInfo = ` (Age: ${item.selectedSize})`;
            } else if (item.category === 'Apparel' && item.gender === 'men') {
                sizeInfo = ` (Size: ${item.selectedSize})`;
            } else {
                sizeInfo = ` (${item.selectedSize})`;
            }
        }
        
        const productTitle = `${item.title}${sizeInfo}`;
        
        tr.innerHTML = `
            <td>
                <div class="cart-item-title">
                    <img class="cart-thumb" src="${item.img}" alt="${item.title}">
                    <div>${productTitle}</div>
                </div>
            </td>
            <td>${formatPrice(Number(item.price))}</td>
            <td><input class="qty-input" type="number" min="1" value="${item.qty}" data-id="${item.cartItemId}"></td>
            <td>${formatPrice(lineTotal)}</td>
            <td><button class="remove-btn" data-id="${item.cartItemId}">Remove</button></td>`;
        tbody.appendChild(tr);
    });

    // Bind qty & remove
    tbody.querySelectorAll('.qty-input').forEach(inp => {
        inp.addEventListener('change', e => {
            const id = inp.getAttribute('data-id');
            changeQty(id, Number(inp.value));
        });
    });
    tbody.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', () => removeFromCart(btn.getAttribute('data-id')));
    });

    renderCartTotals();
}

function renderCartTotals() {
    const subtotal = cart.reduce((s, i) => s + Number(i.price) * i.qty, 0);
    const shipping = cart.length > 0 ? 200 : 0; // Flat PKR 200 delivery when items exist
    const total = subtotal + shipping;
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatPrice(val); };
    setText('subtotal', subtotal);
    setText('shipping', shipping);
    setText('grand-total', total);
}

function setupCheckout() {
    const btn = document.getElementById('checkout-btn');
    if (btn) btn.addEventListener('click', () => {
        if (cart.length === 0) { alert('Your cart is empty.'); return; }

        // Read customer details
        const phone = (document.getElementById('cust-phone')?.value || '').trim();
        const email = (document.getElementById('cust-email')?.value || '').trim();
        const address = (document.getElementById('cust-address')?.value || '').trim();
        const postal = (document.getElementById('cust-postal')?.value || '').trim();
        const city = (document.getElementById('cust-city')?.value || '').trim();
        const country = (document.getElementById('cust-country')?.value || '').trim();
        if (!phone || !email || !address || !postal || !city || !country) {
            alert('Please fill in Phone, Email, Address, Postal Code, City, and Country.');
            return;
        }
        // Persist for convenience
        const cust = { phone, email, address, postal, city, country };
        localStorage.setItem('jdb_cust', JSON.stringify(cust));

        // Build WhatsApp message with line totals
        const subtotal = cart.reduce((s, i) => s + Number(i.price) * i.qty, 0);
        const delivery = 200;
        const total = subtotal + delivery;
        const totalItems = cart.reduce((s, i) => s + i.qty, 0);
        const lines = [];
        lines.push('New JD BANKS Order');
        lines.push(`Items: ${totalItems}`);
        lines.push('');
        cart.forEach(item => {
            const lineTotal = Number(item.price) * item.qty;
            
            // Display appropriate size information based on category
            let sizeInfo = '';
            if (item.selectedSize) {
                if (item.category === 'Shoes') {
                    sizeInfo = ` (EU Size: ${item.selectedSize})`;
                } else if (item.category === 'Dresses') {
                    sizeInfo = ` (Size: ${item.selectedSize})`;
                } else if (item.category === 'Apparel' && item.gender === 'juniors') {
                    sizeInfo = ` (Age: ${item.selectedSize})`;
                } else if (item.category === 'Apparel' && item.gender === 'men') {
                    sizeInfo = ` (Size: ${item.selectedSize})`;
                } else {
                    sizeInfo = ` (${item.selectedSize})`;
                }
            }
            
            const categoryInfo = `${item.gender} ${item.category || 'item'}`;
            const itemDescription = `${item.title}${sizeInfo} - ${categoryInfo}`;
            lines.push(`${item.qty} x ${itemDescription} — ${formatPrice(Number(item.price))} each = ${formatPrice(lineTotal)}`);
        });
        lines.push('');
        lines.push(`Subtotal: ${formatPrice(subtotal)}`);
        lines.push(`Delivery: ${formatPrice(delivery)}`);
        lines.push(`Total: ${formatPrice(total)}`);
        lines.push('');
        lines.push('Customer Details:');
        lines.push(`Phone: ${phone}`);
        lines.push(`Email: ${email}`);
        lines.push(`Address: ${address}`);
        lines.push(`Postal Code: ${postal}`);
        lines.push(`City: ${city}`);
        lines.push(`Country: ${country}`);
        lines.push('');
        lines.push('Please confirm my order.');
        const msg = encodeURIComponent(lines.join('\n'));
        const waPhone = '923028346089'; // WhatsApp number without +
        const waUrl = `https://wa.me/${waPhone}?text=${msg}`;
        // Clear cart before redirecting
        cart = [];
        saveCart();
        updateCartCount();
        renderCart();
        window.location.href = waUrl;
    });
}

// Prefill customer form from localStorage
function prefillCustomerForm() {
    try {
        const cust = JSON.parse(localStorage.getItem('jdb_cust') || 'null');
        if (!cust) return;
        const set = (id, val) => { const el = document.getElementById(id); if (el && !el.value) el.value = val || ''; };
        set('cust-phone', cust.phone);
        set('cust-email', cust.email);
        set('cust-address', cust.address);
        set('cust-postal', cust.postal);
        set('cust-city', cust.city);
        set('cust-country', cust.country);
    } catch {}
}

// ================= Admin: Auth + CRUD =================
const adminFilter = { gender: 'women', category: 'All' };

function setupAdminFilters() {
    const genderSel = document.getElementById('admin-filter-gender');
    const catSel = document.getElementById('admin-filter-category');
    const newBtn = document.getElementById('admin-new');

    const populateCategories = () => {
        if (!catSel) return;
        catSel.innerHTML = '';
        (categoriesByGender[adminFilter.gender] || ['All']).forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            catSel.appendChild(o);
        });
        catSel.value = adminFilter.category;
    };

    if (genderSel) {
        genderSel.value = adminFilter.gender;
        genderSel.addEventListener('change', () => {
            adminFilter.gender = genderSel.value;
            adminFilter.category = 'All';
            populateCategories();
            renderAdminTable();
        });
    }
    if (catSel) {
        populateCategories();
        catSel.addEventListener('change', () => {
            adminFilter.category = catSel.value;
            renderAdminTable();
        });
    }
    if (newBtn) {
        newBtn.addEventListener('click', () => {
            clearAdminForm();
            const title = document.getElementById('admin-form-title');
            if (title) title.textContent = 'Add Product';
            navigateTo('#admin');
        });
    }
}

function setupAdminAuthUI() {
    const loginCard = document.getElementById('admin-login');
    const panel = document.getElementById('admin-panel');
    const signinBtn = document.getElementById('admin-signin');
    const signoutBtn = document.getElementById('admin-signout');

    if (signinBtn) {
        signinBtn.addEventListener('click', async () => {
            const email = document.getElementById('admin-email')?.value || '';
            const password = document.getElementById('admin-password')?.value || '';
            if (!email || !password) { alert('Enter email and password'); return; }
            try {
                await signInWithEmailAndPassword(auth, email, password);
            } catch (e) {
                alert('Sign in failed: ' + (e?.message || e));
            }
        });
    }

    if (signoutBtn) {
        signoutBtn.addEventListener('click', async () => {
            await signOut(auth);
        });
    }

    onAuthStateChanged(auth, (user) => {
        if (loginCard) loginCard.style.display = user ? 'none' : '';
        if (panel) panel.style.display = user ? '' : 'none';
        if (user) {
            bindAdminFormHandlers();
            setupAdminFilters();
        } else {
            clearAdminForm();
        }
    });
}

function clearAdminForm() {
    const ids = ['product-id','product-title','product-price','product-image-url'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const file = document.getElementById('product-image'); if (file) file.value = '';
    // Clear extra images
    const extraIds = ['product-image1-url','product-image2-url','product-image3-url'];
    extraIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const file1 = document.getElementById('product-image1'); if (file1) file1.value = '';
    const file2 = document.getElementById('product-image2'); if (file2) file2.value = '';
    const file3 = document.getElementById('product-image3'); if (file3) file3.value = '';
    const formTitle = document.getElementById('admin-form-title'); if (formTitle) formTitle.textContent = 'Add / Edit Product';
}

function bindAdminFormHandlers() {
    const saveBtn = document.getElementById('product-save');
    const cancelBtn = document.getElementById('product-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', clearAdminForm);
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const idEl = document.getElementById('product-id');
            const titleEl = document.getElementById('product-title');
            const priceEl = document.getElementById('product-price');
            const fileEl = document.getElementById('product-image');
            const urlEl = document.getElementById('product-image-url');

            const title = titleEl?.value?.trim();
            const price = Number(priceEl?.value || 0);
            if (!title || isNaN(price)) { alert('Please fill Title and valid Price'); return; }

            let img = (urlEl?.value || '').trim();
            const file = fileEl?.files?.[0];
            
            // Extra images
            const extraFiles = [
                document.getElementById('product-image1')?.files?.[0] || null,
                document.getElementById('product-image2')?.files?.[0] || null,
                document.getElementById('product-image3')?.files?.[0] || null,
            ];
            const extraUrlsInputs = [
                (document.getElementById('product-image1-url')?.value || '').trim(),
                (document.getElementById('product-image2-url')?.value || '').trim(),
                (document.getElementById('product-image3-url')?.value || '').trim(),
            ];

            try {
                if (file) {
                    const path = `products/${Date.now()}_${file.name}`;
                    const ref = storageRef(storage, path);
                    await uploadBytes(ref, file);
                    img = await getDownloadURL(ref);
                }
                // Upload extra files and collect all extra image URLs
                const uploadedExtras = [];
                for (let i = 0; i < extraFiles.length; i++) {
                    const f = extraFiles[i];
                    const typedUrl = extraUrlsInputs[i];
                    if (f) {
                        const path = `products/${Date.now()}_extra${i+1}_${f.name}`;
                        const ref = storageRef(storage, path);
                        await uploadBytes(ref, f);
                        const dl = await getDownloadURL(ref);
                        uploadedExtras.push(dl);
                    } else if (typedUrl) {
                        uploadedExtras.push(typedUrl);
                    }
                }
                // Trim to max 3
                const newExtras = uploadedExtras.filter(Boolean).slice(0,3);

                const id = idEl?.value;
                if (id) {
                    // Editing: keep original gender/category
                    const existing = catalog.find(p => p.id === id);
                    const gender = existing?.gender || 'women';
                    const category = existing?.category || '';
                    // If neither new files nor URLs were provided, keep existing images as-is
                    const useExistingImages = newExtras.length === 0 ? (existing?.images || []) : newExtras;
                    const payload = { title, price, gender, category, img, images: useExistingImages, updatedAt: serverTimestamp() };
                    await updateDoc(doc(db, 'products', id), payload);
                    showToast('Product updated');
                } else {
                    // Creating: use filters; require specific category (not All)
                    const gender = adminFilter.gender;
                    const category = adminFilter.category;
                    if (!category || category === 'All') { alert('Please choose a specific Category in the top filter (not All).'); return; }
                    const payload = { title, price, gender, category, img, images: newExtras, updatedAt: serverTimestamp() };
                    const toCreate = { ...payload, createdAt: serverTimestamp() };
                    await addDoc(collection(db, 'products'), toCreate);
                    showToast('Product added');
                }
                clearAdminForm();
            } catch (e) {
                alert('Save failed: ' + (e?.message || e));
            }
        });
    }
}

function renderAdminTable() {
    const tbody = document.getElementById('admin-products');
    if (!tbody) return;
    tbody.innerHTML = '';
    const filtered = catalog.filter(p => {
        const genderOk = p.gender === adminFilter.gender;
        const catOk = adminFilter.category === 'All' || (p.category || '') === adminFilter.category;
        return genderOk && catOk;
    });
    filtered.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img src="${p.img}" alt="${p.title}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;"></td>
            <td>${p.title}</td>
            <td>${p.gender}</td>
            <td>${p.category || ''}</td>
            <td>${formatPrice(Number(p.price))}</td>
            <td>
                <button class="secondary-button" data-act="edit" data-id="${p.id}">Edit</button>
                <button class="remove-btn" data-act="del" data-id="${p.id}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            const act = btn.getAttribute('data-act');
            const prod = catalog.find(x => x.id === id);
            if (!prod) return;
            if (act === 'edit') {
                const set = (id,v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
                set('product-id', prod.id);
                set('product-title', prod.title);
                set('product-price', prod.price);
                set('product-image-url', prod.img || '');
                const file = document.getElementById('product-image'); if (file) file.value = '';
                // Prefill extra image URL fields with up to 3 images
                const imgs = Array.isArray(prod.images) ? prod.images : [];
                set('product-image1-url', imgs[0] || '');
                set('product-image2-url', imgs[1] || '');
                set('product-image3-url', imgs[2] || '');
                const f1 = document.getElementById('product-image1'); if (f1) f1.value = '';
                const f2 = document.getElementById('product-image2'); if (f2) f2.value = '';
                const f3 = document.getElementById('product-image3'); if (f3) f3.value = '';
                const formTitle = document.getElementById('admin-form-title'); if (formTitle) formTitle.textContent = 'Edit Product';
                navigateTo('#admin');
            } else if (act === 'del') {
                if (!confirm('Delete this product?')) return;
                try {
                    await deleteDoc(doc(db, 'products', id));
                    showToast('Product deleted');
                } catch (e) {
                    alert('Delete failed: ' + (e?.message || e));
                }
            }
        });
    });
}

// Real-time products subscription
function subscribeProducts() {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snap) => {
        catalog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Refresh storefront
        renderProducts('women-products', 'women');
        renderProducts('men-products', 'men');
        renderProducts('juniors-products', 'juniors');
        // Refresh admin
        renderAdminTable();
    }, (err) => {
        console.error('products snapshot error', err);
    });
}

// Simple image modal state
let modalImages = [];
let modalIndex = 0;

function openImageModal(images, startIndex = 0) {
    modalImages = images || [];
    modalIndex = Math.min(Math.max(0, startIndex), Math.max(0, modalImages.length - 1));
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('image-modal-img');
    if (!modal || !img || modalImages.length === 0) return;
    showModalImage(modalIndex);
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
}

function closeImageModal() {
    const modal = document.getElementById('image-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
}

function showModalImage(i) {
    const img = document.getElementById('image-modal-img');
    if (!img || !modalImages.length) return;
    modalIndex = (i + modalImages.length) % modalImages.length;
    img.src = modalImages[modalIndex];
}

function setupImageModalControls() {
    const closeBtn = document.getElementById('image-modal-close');
    const prevBtn = document.getElementById('image-modal-prev');
    const nextBtn = document.getElementById('image-modal-next');
    const backdrop = document.querySelector('#image-modal .image-modal-backdrop');

    closeBtn?.addEventListener('click', closeImageModal);
    backdrop?.addEventListener('click', closeImageModal);
    prevBtn?.addEventListener('click', () => showModalImage(modalIndex - 1));
    nextBtn?.addEventListener('click', () => showModalImage(modalIndex + 1));

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('image-modal');
        const isOpen = modal?.classList.contains('open');
        if (!isOpen) return;
        if (e.key === 'Escape') closeImageModal();
        if (e.key === 'ArrowLeft') showModalImage(modalIndex - 1);
        if (e.key === 'ArrowRight') showModalImage(modalIndex + 1);
    });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    setupMobileNav();
    setupNav();
    loadCart();
    updateCartCount();

    // Women
    renderCategoryChips('women-categories', 'women');
    renderProducts('women-products', 'women');
    // Men
    renderCategoryChips('men-categories', 'men');
    renderProducts('men-products', 'men');
    // Juniors
    renderCategoryChips('juniors-categories', 'juniors');
    renderProducts('juniors-products', 'juniors');

    // Cart
    renderCart();
    setupCheckout();
    prefillCustomerForm();

    // Admin
    setupAdminAuthUI();
    subscribeProducts();

    // Deep link support
    if (location.hash) navigateTo(location.hash);

    // Modal controls
    setupImageModalControls();
});