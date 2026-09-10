import { db } from './firebase-config.js';
import { initialMenu } from './menu-data.js';
import { autoSeedIfEmpty } from './seed-menu.js';
import { collection, onSnapshot, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// DOM Elements
const menuGrid = document.getElementById('menu-container') || document.getElementById('menu-grid');
const cartCountEl = document.getElementById('cart-count');
const categoryFilter = document.getElementById('category-filters') || document.getElementById('category-filter');
const searchInput = document.getElementById('search-input');

// Active Order Tracker Elements
const activeOrderId = localStorage.getItem('active_order_id');
const banner = document.getElementById('active-order-banner');
const bannerId = document.getElementById('banner-order-id');
const bannerStatus = document.getElementById('banner-order-status');
const cancelBtn = document.getElementById('cancel-order-btn');
const editBtn = document.getElementById('edit-order-btn');

// App State
let menuItems = [...initialMenu];
let cart = JSON.parse(localStorage.getItem('cafe_cart')) || [];
let currentCategory = 'All';
let searchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
    updateCartCount();
    renderMenu(); 
    setupCategoryEvents();
    setupSearchEvent();
    initActiveOrderTracker();
    
    // Auto-seed Firestore menu if empty & listen for real-time stock changes
    await autoSeedIfEmpty();
    initLiveMenuStream();
});

// Real-Time Menu Stream from Firestore
function initLiveMenuStream() {
    onSnapshot(collection(db, "menu"), (snapshot) => {
        if (!snapshot.empty) {
            menuItems = [];
            snapshot.forEach(docSnap => {
                menuItems.push({ id: docSnap.id, ...docSnap.data() });
            });
            renderMenu();
        }
    }, (err) => {
        console.error("Firestore menu stream error:", err);
    });
}

// Mobile Responsive & Clean Badge Menu Render
function renderMenu() {
    if (!menuGrid) return;
    menuGrid.innerHTML = '';

    const filteredMenu = menuItems.filter(item => {
        const matchesCategory = currentCategory === 'All' || item.category === currentCategory;
        const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    if (filteredMenu.length === 0) {
        menuGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #6b7280;">
                <p style="font-size: 1rem; font-weight: 500;">No items found matching your criteria.</p>
            </div>
        `;
        return;
    }

    filteredMenu.forEach(item => {
        const card = document.createElement('div');
        const isSoldOut = item.inStock === false;
        card.className = `menu-card ${isSoldOut ? 'out-of-stock' : ''}`;

        card.innerHTML = `
            ${isSoldOut ? '<span class="stock-badge-soldout">SOLD OUT</span>' : ''}
            <div>
                <h3 class="card-title" style="padding-right: ${isSoldOut ? '65px' : '0px'};">${item.name}</h3>
                <span class="card-category">${item.category}</span>
                <div class="card-price">PKR ${item.price}</div>
            </div>
            <button 
                class="add-btn" 
                ${isSoldOut ? 'disabled' : ''}>
                ${!isSoldOut ? '+ Add to Order' : 'Out of Stock'}
            </button>
        `;

        const addBtn = card.querySelector('.add-btn');
        if (!isSoldOut && addBtn) {
            addBtn.addEventListener('click', () => addToCart(item));
        }

        menuGrid.appendChild(card);
    });
}

// Cart Logic
function addToCart(item) {
    const existingIndex = cart.findIndex(c => c.id === item.id);

    if (existingIndex > -1) {
        cart[existingIndex].qty += 1;
    } else {
        cart.push({
            id: item.id,
            name: item.name,
            price: item.price,
            qty: 1,
            notes: ''
        });
    }

    saveCart();
    updateCartCount();
}

function saveCart() {
    localStorage.setItem('cafe_cart', JSON.stringify(cart));
}

function updateCartCount() {
    if (cartCountEl) {
        const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
        cartCountEl.textContent = totalQty;
    }
}

// Category & Search Filters
function setupCategoryEvents() {
    if (!categoryFilter) return;
    categoryFilter.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            
            currentCategory = e.target.getAttribute('data-category') || e.target.textContent.trim();
            renderMenu();
        }
    });
}

function setupSearchEvent() {
    if (!searchInput) return;
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderMenu();
    });
}

// Active Order Tracker Logic
function initActiveOrderTracker() {
    if (!activeOrderId || !banner) return;

    const orderRef = doc(db, "orders", activeOrderId);

    onSnapshot(orderRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();

            // Clear tracker if Order is Completed or Cancelled by Admin
            if (data.status === 'Completed' || data.status === 'Cancelled') {
                localStorage.removeItem('active_order_id');
                banner.style.display = 'none';
                return;
            }

            banner.style.display = 'block';

            // Token Date Prefix Generator
            let datePrefix = '';
            if (data.createdAt && data.createdAt.seconds) {
                const d = new Date(data.createdAt.seconds * 1000);
                const day = String(d.getDate()).padStart(2, '0');
                const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
                datePrefix = `${day}${month}`;
            } else {
                const d = new Date();
                const day = String(d.getDate()).padStart(2, '0');
                const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
                datePrefix = `${day}${month}`;
            }

            const formattedToken = data.tokenNo 
                ? `#${datePrefix}-${data.tokenNo}` 
                : `#${activeOrderId.slice(-4).toUpperCase()}`;

            if (bannerId) bannerId.textContent = formattedToken;
            if (bannerStatus) bannerStatus.textContent = data.status;

            // Lock controls when order state shifts past Pending
            const isLocked = data.status !== 'Pending';

            if (cancelBtn) {
                cancelBtn.disabled = isLocked;
                cancelBtn.style.background = isLocked ? '#ccc' : '#ef4444';
                cancelBtn.style.cursor = isLocked ? 'not-allowed' : 'pointer';
                cancelBtn.textContent = isLocked ? 'Preparing (Locked)' : 'Cancel Order';
            }

            if (editBtn) {
                editBtn.disabled = isLocked;
                editBtn.style.background = isLocked ? '#ccc' : '#3b82f6';
                editBtn.style.cursor = isLocked ? 'not-allowed' : 'pointer';
                
                editBtn.onclick = async () => {
                    if (isLocked) return;
                    if (confirm("Editing will restore your order items to cart. Continue?")) {
                        try {
                            localStorage.setItem('cafe_cart', JSON.stringify(data.items));
                            await deleteDoc(orderRef);
                            localStorage.removeItem('active_order_id');
                            window.location.href = "cart.html";
                        } catch (err) {
                            console.error("Error editing order:", err);
                        }
                    }
                };
            }

            if (cancelBtn && !isLocked) {
                cancelBtn.onclick = async () => {
                    if (confirm("Are you sure you want to cancel this order?")) {
                        try {
                            await deleteDoc(orderRef);
                            localStorage.removeItem('active_order_id');
                            banner.style.display = 'none';
                            alert("Order cancelled successfully.");
                        } catch (err) {
                            console.error("Error cancelling order:", err);
                        }
                    }
                };
            }

        } else {
            localStorage.removeItem('active_order_id');
            banner.style.display = 'none';
        }
    });
}