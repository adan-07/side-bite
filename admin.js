import { db } from './firebase-config.js';
import { initialMenu } from './menu-data.js';
import { autoSeedIfEmpty } from './seed-menu.js';
import { 
    collection, 
    onSnapshot, 
    doc, 
    updateDoc, 
    deleteDoc, 
    setDoc, 
    getDocs,
    query, 
    orderBy,
    where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const auth = getAuth();

// Global Dynamic Edit Cart Tracker for POS Modal
window.editingCartItems = [];

// 1. Authentication Check & Initialization
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "admin-login.html";
    } else {
        initAdminDashboard();
        await autoSeedIfEmpty();
        initInventoryControl();
        setupAddItemForm();
        setupFilterListeners();
        setupBillingSearchAndEvents();
        setupReportDateFilter();
        loadAllCustomerDetails();
        setupModalCalculationListeners();
    }
});

// Logout Listener
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth).then(() => {
            window.location.href = "admin-login.html";
        });
    });
}

// DOM Elements
const ordersContainer = document.getElementById('admin-orders-container');
const billingContainer = document.getElementById('admin-billing-container');
const financialsSummaryContainer = document.getElementById('admin-financials-summary');
const khataContainer = document.getElementById('admin-khata-container');
const inventoryContainer = document.getElementById('admin-inventory-list');
const editModal = document.getElementById('edit-modal');
const editCartList = document.getElementById('edit-cart-list');
const saveEditBtn = document.getElementById('save-edit-btn');
const closeEditBtn = document.getElementById('close-edit-btn');
const cancelModal = document.getElementById('cancel-reason-modal');
const closeCancelModalBtn = document.getElementById('close-cancel-modal-btn');
const confirmCancelOrderBtn = document.getElementById('confirm-cancel-order-btn');

// Stats Elements
const statActiveCount = document.getElementById('stat-active-count');
const statTotalRevenue = document.getElementById('stat-total-revenue');
const statCashRevenue = document.getElementById('stat-cash-revenue');
const statOnlineRevenue = document.getElementById('stat-online-revenue');
const statLoanBalance = document.getElementById('stat-loan-balance');

const addItemForm = document.getElementById('add-item-form');

let activeOrders = [];
let liveMenuCache = [];
let currentEditingOrderId = null;
let selectedBillingOrderId = null;
let orderToCancelId = null;
let currentFilter = 'all';

// Thermal Receipt Isolated Print Function
window.triggerReceiptPrint = (orderId) => {
    const targetOrder = activeOrders.find(o => o.id === orderId) || activeOrders.find(o => o.id === selectedBillingOrderId);
    if (!targetOrder) {
        alert("Select an order to print receipt.");
        return;
    }

    const items = targetOrder.items || [];
    const subtotal = items.reduce((acc, i) => acc + (Number(i.price || 0) * Number(i.qty || 1)), 0);
    const discount = Number(targetOrder.discount || 0);
    const total = Number(targetOrder.total || subtotal - discount);
    const payStatus = targetOrder.paymentStatus || 'Unpaid';
    const paidAmount = payStatus === 'Paid' ? total : 0;
    const pendingAmount = payStatus === 'Paid' ? 0 : total;

    let dateStr = targetOrder.createdAt && targetOrder.createdAt.seconds 
        ? new Date(targetOrder.createdAt.seconds * 1000).toLocaleString() 
        : new Date().toLocaleString();

    let itemsTable = items.map(i => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85rem;">
            <span>${i.qty}x ${i.name}</span>
            <span>${(Number(i.price) * Number(i.qty)).toFixed(2)}</span>
        </div>
    `).join('');

    const receiptHtml = `
        <div class="printable-receipt" style="width: 100%; font-family: monospace; padding: 5px;">
            <div style="text-align: center; font-weight: bold; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
                <div style="font-size: 1.1rem;">[ Side Bite 🍔   ]</div>
                <div style="font-size: 0.8rem; text-transform: uppercase;">Side Bite 🍔  Management</div>
            </div>
            
            <div style="font-size: 0.8rem; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
                <div>Order ID: ${targetOrder.tokenNo || targetOrder.id.slice(-4).toUpperCase()}</div>
                <div>Date: ${dateStr}</div>
                <div>Cashier: ${targetOrder.doneBy || 'Admin'}</div>
                <div>Customer: ${targetOrder.customerName || 'Walk-in'} Table: ${targetOrder.tableNo || 'N/A'}</div>
                <div>Type: ${targetOrder.orderType || 'Dine-in'}</div>
            </div>

            <div style="border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 0.8rem; margin-bottom: 4px;">
                    <span>Sr Item</span>
                    <span>Sub</span>
                </div>
                ${itemsTable}
            </div>

            <div style="font-size: 0.85rem; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between;"><span>Subtotal:</span> <span>${subtotal.toFixed(2)}</span></div>
                <div style="display: flex; justify-content: space-between;"><span>Discount:</span> <span>${discount.toFixed(2)}</span></div>
                <div style="display: flex; justify-content: space-between; font-weight: bold;"><span>Grand Total:</span> <span>${total.toFixed(2)}</span></div>
                <div style="display: flex; justify-content: space-between;"><span>Paid Amount:</span> <span>${paidAmount.toFixed(2)}</span></div>
                <div style="display: flex; justify-content: space-between;"><span>Pending:</span> <span>${pendingAmount.toFixed(2)}</span></div>
            </div>

            <div style="text-align: center; font-size: 0.75rem; margin-top: 10px;">
                Thank you! Please visit again.
            </div>
        </div>
    `;

    let printContainer = document.getElementById('printable-receipt-area');
    if (!printContainer) {
        printContainer = document.createElement('div');
        printContainer.id = 'printable-receipt-area';
        document.body.appendChild(printContainer);
    }

    printContainer.innerHTML = receiptHtml;
    window.print();
};

// Filter Event Listeners Initialization
function setupFilterListeners() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.getAttribute('data-filter') || 'all';
            renderFilteredOrders();
        });
    });
}

// Render Order Card (WITHOUT PRINT BUTTON IN ORDER MANAGEMENT)
function renderOrderCard(order) {
    const card = document.createElement('div');
    card.className = `order-card ${order.status ? order.status.toLowerCase() : ''}`;
    card.style.cssText = "background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);";

    const itemsListHtml = (order.items || []).map(item => `
        <div style="display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 4px;">
            <span>${item.qty || 1}x ${item.name}</span>
            <span>PKR ${((Number(item.price) || 0) * (Number(item.qty) || 1)).toFixed(2)}</span>
        </div>
    `).join('');

    const tokenDisplay = order.tokenNo ? `Ticket #${order.tokenNo}` : `ID: ${order.id.slice(-4).toUpperCase()}`;

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding-bottom: 8px; margin-bottom: 10px;">
            <div>
                <h4 style="margin: 0; font-size: 1.1rem; color: #111827;">${tokenDisplay} <small style="font-weight: normal; color: #6b7280;">(${order.orderType || order.tableNo || 'Takeaway'})</small></h4>
                <small style="color: #6b7280;">Customer: ${order.customerName || 'Walk-in'} | Phone: ${order.customerPhone || 'N/A'}</small>
            </div>
            <div>
                <span style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.75rem;">${order.status || 'Pending'}</span>
                <span style="background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.75rem;">${order.paymentStatus || 'Unpaid'}</span>
            </div>
        </div>

        <div style="margin-bottom: 12px; background: #fafafa; padding: 8px; border-radius: 6px;">
            ${itemsListHtml}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; margin-bottom: 12px;">
            <span>Total Bill: PKR ${(Number(order.total) || 0).toFixed(2)}</span>
            <span style="color: ${order.paymentStatus === 'Paid' ? '#059669' : '#dc2626'};">${order.paymentStatus || 'Unpaid'} (${order.paymentMethod || 'Cash'})</span>
        </div>

        <div style="display: flex; gap: 8px; align-items: center;">
            <select onchange="updateOrderStatus('${order.id}', this.value)" style="padding: 6px 10px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; font-size: 0.85rem;">
                <option value="Pending" ${order.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                <option value="Preparing" ${order.status === 'Preparing' ? 'selected' : ''}>👩‍🍳 Preparing</option>
                <option value="Ready" ${order.status === 'Ready' ? 'selected' : ''}>✅ Ready</option>
                <option value="Completed" ${order.status === 'Completed' ? 'selected' : ''}>🎉 Complete</option>
            </select>

            <button class="btn-action btn-edit" onclick="editOrder('${order.id}')" style="background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">🛠️ Edit POS</button>
            <button class="btn-action btn-delete" onclick="openCancelModal('${order.id}')" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">Cancel</button>
        </div>
    `;

    return card;
}

// Render Orders based on Active Filter
function renderFilteredOrders() {
    if (!ordersContainer) return;
    ordersContainer.innerHTML = '';
    
    const filtered = activeOrders.filter(order => {
        const status = (order.status || 'Pending').toLowerCase();
        const payStatus = (order.paymentStatus || 'Unpaid').toLowerCase();
        const payMethod = (order.paymentMethod || 'Cash').toLowerCase();

        if (currentFilter === 'all') return true;
        if (currentFilter === 'active') return status !== 'completed' && status !== 'cancelled';
        if (currentFilter === 'pending') return status === 'pending';
        if (currentFilter === 'preparing') return status === 'preparing';
        if (currentFilter === 'ready') return status === 'ready';
        if (currentFilter === 'completed') return status === 'completed';
        if (currentFilter === 'cancelled') return status === 'cancelled';
        if (currentFilter === 'paid') return payStatus === 'paid';
        if (currentFilter === 'unpaid') return payStatus === 'unpaid';
        if (currentFilter === 'loan') return payStatus === 'loan' || payMethod === 'loan';
        if (currentFilter === 'cash') return payMethod === 'cash';
        return true;
    });

    if (filtered.length === 0) {
        ordersContainer.innerHTML = `<p style="text-align: center; color: #666; padding: 20px;">No orders found for category: <strong>${currentFilter.toUpperCase()}</strong></p>`;
        return;
    }

    filtered.forEach(order => {
        const cardNode = renderOrderCard(order);
        if (cardNode) ordersContainer.appendChild(cardNode);
    });
}

// 2. Real-Time All Customers Ledger
window.loadAllCustomerDetails = async () => {
    if (!khataContainer) return;

    khataContainer.innerHTML = '<p style="color: #666; padding: 10px;">Loading customer records...</p>';

    try {
        const querySnapshot = await getDocs(collection(db, "orders"));
        const customerMap = {};

        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const phone = data.customerPhone || 'N/A';
            const name = data.customerName || 'Walk-in Customer';
            const total = Number(data.total || data.totalAmount || 0);
            const isUnpaid = data.paymentStatus === 'Unpaid' || data.paymentMethod === 'Credit/Loan' || data.paymentStatus === 'Loan';

            if (!customerMap[phone]) {
                customerMap[phone] = {
                    name: name,
                    phone: phone,
                    totalOrders: 0,
                    pendingLoan: 0
                };
            }

            customerMap[phone].totalOrders += 1;
            if (isUnpaid && data.status !== 'Cancelled') {
                customerMap[phone].pendingLoan += total;
            }
        });

        const customersList = Object.values(customerMap);
        if (customersList.length === 0) {
            khataContainer.innerHTML = '<p style="color: #666; padding: 10px;">No customer records available.</p>';
            return;
        }

        let rowsHtml = customersList.map(cust => {
            const hasLoan = cust.pendingLoan > 0;
            return `
                <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.9rem;">
                    <td style="padding: 10px; font-weight: bold;">${cust.name}</td>
                    <td style="padding: 10px;">${cust.phone}</td>
                    <td style="padding: 10px; text-align: center;">${cust.totalOrders}</td>
                    <td style="padding: 10px; text-align: center;">
                        <span style="background: ${hasLoan ? '#fee2e2' : '#dcfce7'}; color: ${hasLoan ? '#991b1b' : '#166534'}; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 0.8rem;">
                            ${hasLoan ? 'Loan Pending' : 'Clear'}
                        </span>
                    </td>
                    <td style="padding: 10px; font-weight: bold; color: ${hasLoan ? '#dc2626' : '#059669'};">
                        PKR ${cust.pendingLoan.toFixed(2)}
                    </td>
                </tr>
            `;
        }).join('');

        khataContainer.innerHTML = `
            <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-top: 15px;">
                <h3 style="margin-bottom: 12px; color: #1f2937;">👥 All Registered Customers Ledger</h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead style="background: #f3f4f6; font-size: 0.85rem; text-transform: uppercase; color: #374151;">
                            <tr>
                                <th style="padding: 10px;">Customer Name</th>
                                <th style="padding: 10px;">Phone Number</th>
                                <th style="padding: 10px; text-align: center;">Total Orders</th>
                                <th style="padding: 10px; text-align: center;">Account Status</th>
                                <th style="padding: 10px;">Loan Balance</th>
                            </tr>
                        </thead>
                        <tbody id="customerTableBody">
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

    } catch (err) {
        console.error("Error loading customer details:", err);
        khataContainer.innerHTML = '<p style="color: #ef4444; padding: 10px;">Failed to load customer records.</p>';
    }
};

// 3. Orders Real-Time Stream
function initAdminDashboard() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const ordersQuery = query(
        collection(db, "orders"), 
        where("createdAt", ">=", startOfToday),
        orderBy("createdAt", "desc")
    );

    onSnapshot(ordersQuery, (snapshot) => {
        activeOrders = [];

        if (snapshot.empty) {
            if (ordersContainer) ordersContainer.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No active orders today.</p>';
            resetStats();
            renderBillingView([]);
            renderFinancialsView(0, 0, 0, 0, 0, []);
            return;
        }

        let totalSales = 0;
        let cashSales = 0;
        let onlineSales = 0;
        let LoanBalance = 0;
        let activeCount = 0;

        snapshot.forEach(docSnap => {
            const orderData = docSnap.data();
            orderData.id = docSnap.id;
            activeOrders.push(orderData);

            const amount = Number(orderData.total || 0);
            const payStatus = orderData.paymentStatus || 'Unpaid';
            const payMethod = orderData.paymentMethod || 'Cash';
            const isPaid = payStatus === 'Paid';
            const isLoan = payStatus === 'Loan' || payMethod === 'Loan';

            if (orderData.status === 'Completed' || isPaid) {
                totalSales += amount;
                if (payMethod === 'Cash') {
                    cashSales += amount;
                } else if (payMethod === 'Online' || payMethod === 'Card' || payMethod === 'JazzCash/EasyPaisa') {
                    onlineSales += amount;
                }
            }

            if (isLoan && orderData.status !== 'Cancelled') {
                LoanBalance += amount;
            }

            if (orderData.status !== 'Completed' && orderData.status !== 'Cancelled') {
                activeCount++;
            }
        });

        if (statActiveCount) statActiveCount.textContent = activeCount;
        if (statTotalRevenue) statTotalRevenue.textContent = totalSales;
        if (statCashRevenue) statCashRevenue.textContent = cashSales;
        if (statOnlineRevenue) statOnlineRevenue.textContent = onlineSales;
        if (statLoanBalance) statLoanBalance.textContent = LoanBalance;

        renderFilteredOrders();
        renderBillingView(activeOrders);
        renderFinancialsView(totalSales, cashSales, onlineSales, LoanBalance, activeOrders.length, activeOrders);
    });
}

function resetStats() {
    if (statActiveCount) statActiveCount.textContent = '0';
    if (statTotalRevenue) statTotalRevenue.textContent = '0';
    if (statCashRevenue) statCashRevenue.textContent = '0';
    if (statOnlineRevenue) statOnlineRevenue.textContent = '0';
    if (statLoanBalance) statLoanBalance.textContent = '0';
}

// BILLING MANAGEMENT SECTION
function setupBillingSearchAndEvents() {
    const searchInput = document.getElementById('billing-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const queryVal = searchInput.value.toLowerCase().trim();
            const filtered = activeOrders.filter(o => 
                (o.customerName || '').toLowerCase().includes(queryVal) ||
                (o.tokenNo || '').toString().toLowerCase().includes(queryVal) ||
                (o.id || '').toLowerCase().includes(queryVal) ||
                (o.customerPhone || '').includes(queryVal)
            );
            renderBillingView(filtered);
        });
    }
}

function renderBillingView(orders) {
    if (!billingContainer) return;

    if (!orders || orders.length === 0) {
        billingContainer.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No billing records available.</p>';
        renderBillPreview(null);
        return;
    }

    let grandTotalSales = 0;

    let tableRowsHtml = orders.map(order => {
        const docId = order.id || '';
        const payStatus = order.paymentStatus || 'Unpaid';
        const isPending = payStatus !== 'Paid';
        const payMethod = order.paymentMethod || 'Cash';
        const orderType = order.orderType || order.tableNo || 'Dine-in';
        const subtotal = (order.items || []).reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.qty || 1)), 0);
        const discount = Number(order.discount || 0);
        const total = Number(order.total || 0);
        
        if (payStatus === 'Paid') {
            grandTotalSales += total;
        }

        const paidAmount = payStatus === 'Paid' ? total : 0;
        const pendingAmount = payStatus === 'Paid' ? 0 : total;

        let dateStr = order.createdAt && order.createdAt.seconds 
            ? new Date(order.createdAt.seconds * 1000).toISOString().replace('T', ' ').substring(0, 16)
            : new Date().toISOString().replace('T', ' ').substring(0, 16);

        const isSelected = selectedBillingOrderId === docId;
        const highlightStyle = isPending 
            ? 'background: #fef08a;' 
            : (isSelected ? 'background: #0284c7; color: #fff;' : 'background: #fff;');

        return `
            <tr onclick="selectBillingOrder('${docId}')" style="cursor: pointer; ${highlightStyle} border-bottom: 1px solid #e5e7eb; font-size: 0.85rem;">
                <td style="padding: 6px 8px;">${order.tokenNo || docId.slice(-4).toUpperCase()}</td>
                <td style="padding: 6px 8px;">${dateStr}</td>
                <td style="padding: 6px 8px;">${subtotal.toFixed(2)}</td>
                <td style="padding: 6px 8px;">${discount.toFixed(2)}</td>
                <td style="padding: 6px 8px; font-weight: bold;">${total.toFixed(2)}</td>
                <td style="padding: 6px 8px;">${order.doneBy || 'Cashier'}</td>
                <td style="padding: 6px 8px;">${order.customerName || '-'}</td>
                <td style="padding: 6px 8px;">${order.customerPhone || '-'}</td>
                <td style="padding: 6px 8px;">${order.tableNo || '-'}</td>
                <td style="padding: 6px 8px;">${orderType}</td>
                <td style="padding: 6px 8px; font-weight: bold;">${payStatus}</td>
                <td style="padding: 6px 8px;">${paidAmount.toFixed(2)}</td>
                <td style="padding: 6px 8px; color: ${pendingAmount > 0 ? '#b91c1c' : 'inherit'};">${pendingAmount.toFixed(2)}</td>
                <td style="padding: 6px 8px;">${payMethod}</td>
            </tr>
        `;
    }).join('');

    billingContainer.innerHTML = `
        <div style="display: flex; gap: 15px; flex-wrap: wrap;">
            <div style="flex: 3; min-width: 300px; overflow-x: auto; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; padding: 10px;">
                <div style="max-height: 420px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead style="background: #f3f4f6; position: sticky; top: 0; font-size: 0.8rem; text-transform: uppercase; color: #374151;">
                            <tr>
                                <th style="padding: 8px;">Order ID</th>
                                <th style="padding: 8px;">Date</th>
                                <th style="padding: 8px;">Subtotal</th>
                                <th style="padding: 8px;">Discount</th>
                                <th style="padding: 8px;">Total</th>
                                <th style="padding: 8px;">Done By</th>
                                <th style="padding: 8px;">Customer</th>
                                <th style="padding: 8px;">Phone</th>
                                <th style="padding: 8px;">Table</th>
                                <th style="padding: 8px;">Order Typ</th>
                                <th style="padding: 8px;">Status</th>
                                <th style="padding: 8px;">Paid Amnt</th>
                                <th style="padding: 8px;">Pending</th>
                                <th style="padding: 8px;">Payment Meth</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; background: #f9fafb; padding: 10px; border-radius: 4px; flex-wrap: wrap; gap: 10px;">
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button onclick="toggleSelectedPendingReceived()" style="background: #4b5563; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Toggle Pending/Received</button>
                        <button onclick="editSelectedBillPOS()" style="background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Edit Bill</button>
                    </div>
                    <div style="font-size: 1.1rem; font-weight: bold; color: #059669;">
                        Grand Total Sales: RS ${grandTotalSales.toFixed(2)}
                    </div>
                </div>
            </div>

            <div style="flex: 1; min-width: 280px; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; padding: 15px; font-family: monospace;" id="thermal-bill-preview">
            </div>
        </div>
    `;

    if (!selectedBillingOrderId && orders.length > 0) {
        selectedBillingOrderId = orders[0].id;
    }
    const currentSelected = orders.find(o => o.id === selectedBillingOrderId) || orders[0];
    renderBillPreview(currentSelected);
}

window.selectBillingOrder = (docId) => {
    selectedBillingOrderId = docId;
    renderBillingView(activeOrders);
};

function renderBillPreview(order) {
    const previewContainer = document.getElementById('thermal-bill-preview');
    if (!previewContainer) return;

    if (!order) {
        previewContainer.innerHTML = '<p style="text-align: center; color: #9ca3af;">Select an order to view receipt preview.</p>';
        return;
    }

    const items = order.items || [];
    const subtotal = items.reduce((acc, i) => acc + (Number(i.price || 0) * Number(i.qty || 1)), 0);
    const discount = Number(order.discount || 0);
    const total = Number(order.total || 0);
    const payStatus = order.paymentStatus || 'Unpaid';
    const paidAmount = payStatus === 'Paid' ? total : 0;
    const pendingAmount = payStatus === 'Paid' ? 0 : total;

    let dateStr = order.createdAt && order.createdAt.seconds 
        ? new Date(order.createdAt.seconds * 1000).toLocaleString() 
        : new Date().toLocaleString();

    let itemsTable = items.map(i => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85rem;">
            <span>${i.qty}x ${i.name}</span>
            <span>${(Number(i.price) * Number(i.qty)).toFixed(2)}</span>
        </div>
    `).join('');

    previewContainer.innerHTML = `
        <div style="text-align: center; font-weight: bold; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-size: 1.1rem;">[ Side Bite 🍔  ]</div>
            <div style="font-size: 0.8rem; text-transform: uppercase;">Side Bite 🍔  Management</div>
        </div>
        
        <div style="font-size: 0.8rem; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div>Order ID: ${order.tokenNo || order.id.slice(-4).toUpperCase()}</div>
            <div>Date: ${dateStr}</div>
            <div>Cashier: ${order.doneBy || 'Admin'}</div>
            <div>Customer: ${order.customerName || 'Walk-in'} Table: ${order.tableNo || 'N/A'}</div>
            <div>Type: ${order.orderType || 'Dine-in'}</div>
        </div>

        <div style="border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 0.8rem; margin-bottom: 4px;">
                <span>Sr Item</span>
                <span>Sub</span>
            </div>
            ${itemsTable}
        </div>

        <div style="font-size: 0.85rem; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between;"><span>Subtotal:</span> <span>${subtotal.toFixed(2)}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Discount:</span> <span>${discount.toFixed(2)}</span></div>
            <div style="display: flex; justify-content: space-between; font-weight: bold;"><span>Grand Total:</span> <span>${total.toFixed(2)}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Paid Amount:</span> <span>${paidAmount.toFixed(2)}</span></div>
            <div style="display: flex; justify-content: space-between; color: ${pendingAmount > 0 ? '#b91c1c' : 'inherit'};"><span>Pending:</span> <span>${pendingAmount.toFixed(2)}</span></div>
        </div>

        <div style="text-align: center; font-size: 0.75rem; margin-top: 10px; color: #4b5563;">
            Thank you! Please visit again.
        </div>

        <button onclick="triggerReceiptPrint('${order.id}')" style="margin-top: 12px; width: 100%; background: #059669; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-family: sans-serif;">
            🖨️ Print Receipt
        </button>
    `;
}

window.toggleSelectedPendingReceived = async () => {
    if (!selectedBillingOrderId) {
        alert("Please select an order row first.");
        return;
    }
    const order = activeOrders.find(o => o.id === selectedBillingOrderId);
    if (!order) return;

    const newPayStatus = order.paymentStatus === 'Paid' ? 'Unpaid' : 'Paid';
    try {
        await updateDoc(doc(db, "orders", selectedBillingOrderId), {
            paymentStatus: newPayStatus
        });
        loadAllCustomerDetails();
    } catch (err) {
        console.error("Error toggling payment status:", err);
    }
};

window.editSelectedBillPOS = () => {
    if (!selectedBillingOrderId) {
        alert("Please select an order row first.");
        return;
    }
    window.editOrder(selectedBillingOrderId);
};

// LIVE CALCULATION & MODAL CONTROLS FIX
window.calculateModalTotal = () => {
    let subtotal = 0;

    // Active items inside global cart
    if (window.editingCartItems && Array.isArray(window.editingCartItems)) {
        subtotal = window.editingCartItems.reduce((sum, item) => {
            const price = parseFloat(item.price) || 0;
            const qty = parseInt(item.qty || item.quantity) || 1;
            return sum + (price * qty);
        }, 0);
    }

    const taxRate = parseFloat(document.getElementById('edit-tax-rate')?.value) || 0;
    const serviceFee = parseFloat(document.getElementById('edit-service-fee')?.value) || 0;
    const discountVal = parseFloat(document.getElementById('edit-discount-value')?.value) || 0;
    const discountType = document.getElementById('edit-discount-type')?.value || 'percent';

    const taxAmount = (subtotal * taxRate) / 100;
    let total = subtotal + taxAmount + serviceFee;

    let discountAmount = 0;
    if (discountType === 'percent') {
        discountAmount = (total * discountVal) / 100;
    } else {
        discountAmount = discountVal;
    }

    const finalTotal = Math.max(0, Math.round(total - discountAmount));

    const totalDisplay = document.getElementById('edit-modal-final-total');
    if (totalDisplay) {
        totalDisplay.textContent = `PKR ${finalTotal.toLocaleString()}`;
    }
};

function setupModalCalculationListeners() {
    ['edit-tax-rate', 'edit-service-fee', 'edit-discount-value', 'edit-discount-type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', window.calculateModalTotal);
            el.addEventListener('change', window.calculateModalTotal);
        }
    });
}

// EDIT POS ORDER MODAL ENGINE
window.editOrder = (orderId) => {
    const order = activeOrders.find(o => o.id === orderId);
    if (!order) return;

    currentEditingOrderId = orderId;
    window.editingCartItems = [...(order.items || [])];

    // Populating basic inputs
    if (document.getElementById('edit-customer-name')) document.getElementById('edit-customer-name').value = order.customerName || '';
    if (document.getElementById('edit-customer-phone')) document.getElementById('edit-customer-phone').value = order.customerPhone || '';
    if (document.getElementById('edit-table-no')) document.getElementById('edit-table-no').value = order.tableNo || '';
    if (document.getElementById('edit-discount-value')) document.getElementById('edit-discount-value').value = order.discount || 0;
    if (document.getElementById('edit-payment-status')) document.getElementById('edit-payment-status').value = order.paymentStatus || 'Unpaid';
    if (document.getElementById('edit-payment-method')) document.getElementById('edit-payment-method').value = order.paymentMethod || 'Cash';

    renderModalCartItems();
    if (editModal) editModal.style.display = 'block';
};

function renderModalCartItems() {
    if (!editCartList) return;
    editCartList.innerHTML = '';

    window.editingCartItems.forEach((item, index) => {
        const itemRow = document.createElement('div');
        itemRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 6px; background: #f8fafc; border-radius: 6px;";
        itemRow.innerHTML = `
            <span><strong>${item.name}</strong> (PKR ${item.price})</span>
            <div>
                <button onclick="changeModalQty(${index}, -1)" style="padding: 2px 8px;">-</button>
                <span style="margin: 0 8px; font-weight: bold;">${item.qty || 1}</span>
                <button onclick="changeModalQty(${index}, 1)" style="padding: 2px 8px;">+</button>
                <button onclick="removeModalItem(${index})" style="margin-left: 8px; color: red; background: none; border: none; cursor: pointer;">🗑️</button>
            </div>
        `;
        editCartList.appendChild(itemRow);
    });

    window.calculateModalTotal();
}

window.changeModalQty = (index, delta) => {
    if (window.editingCartItems[index]) {
        window.editingCartItems[index].qty = (window.editingCartItems[index].qty || 1) + delta;
        if (window.editingCartItems[index].qty <= 0) {
            window.editingCartItems.splice(index, 1);
        }
    }
    renderModalCartItems();
};

window.removeModalItem = (index) => {
    window.editingCartItems.splice(index, 1);
    renderModalCartItems();
};

if (closeEditBtn) {
    closeEditBtn.addEventListener('click', () => {
        if (editModal) editModal.style.display = 'none';
    });
}

if (saveEditBtn) {
    saveEditBtn.addEventListener('click', async () => {
        if (!currentEditingOrderId) return;

        const custName = document.getElementById('edit-customer-name')?.value || 'Walk-in';
        const custPhone = document.getElementById('edit-customer-phone')?.value || 'N/A';
        const tableNo = document.getElementById('edit-table-no')?.value || 'N/A';
        const taxRate = parseFloat(document.getElementById('edit-tax-rate')?.value) || 0;
        const serviceFee = parseFloat(document.getElementById('edit-service-fee')?.value) || 0;
        const discountVal = parseFloat(document.getElementById('edit-discount-value')?.value) || 0;
        const discountType = document.getElementById('edit-discount-type')?.value || 'percent';
        const payStatus = document.getElementById('edit-payment-status')?.value || 'Unpaid';
        const payMethod = document.getElementById('edit-payment-method')?.value || 'Cash';

        let subtotal = window.editingCartItems.reduce((acc, i) => acc + (Number(i.price || 0) * Number(i.qty || 1)), 0);
        let taxAmt = (subtotal * taxRate) / 100;
        let runningTotal = subtotal + taxAmt + serviceFee;
        let discountAmt = discountType === 'percent' ? (runningTotal * discountVal) / 100 : discountVal;
        let finalTotal = Math.max(0, Math.round(runningTotal - discountAmt));

        try {
            await updateDoc(doc(db, "orders", currentEditingOrderId), {
                customerName: custName,
                customerPhone: custPhone,
                tableNo: tableNo,
                items: window.editingCartItems,
                discount: discountAmt,
                taxRate: taxRate,
                serviceFee: serviceFee,
                total: finalTotal,
                paymentStatus: payStatus,
                paymentMethod: payMethod
            });

            if (editModal) editModal.style.display = 'none';
            loadAllCustomerDetails();
        } catch (err) {
            console.error("Failed to update order:", err);
            alert("Error saving updated order.");
        }
    });
}

// CANCEL MODAL ENGINE
window.openCancelModal = (orderId) => {
    orderToCancelId = orderId;
    if (cancelModal) cancelModal.style.display = 'block';
};

if (closeCancelModalBtn) {
    closeCancelModalBtn.addEventListener('click', () => {
        if (cancelModal) cancelModal.style.display = 'none';
    });
}

if (confirmCancelOrderBtn) {
    confirmCancelOrderBtn.addEventListener('click', async () => {
        if (!orderToCancelId) return;

        const cancelReason = document.getElementById('cancel-reason-text')?.value || 'Customer Cancelled';

        try {
            await updateDoc(doc(db, "orders", orderToCancelId), {
                status: 'Cancelled',
                cancelReason: cancelReason
            });

            if (cancelModal) cancelModal.style.display = 'none';
        } catch (err) {
            console.error("Error cancelling order:", err);
        }
    });
}

// UPDATE STATUS ENGINE
window.updateOrderStatus = async (orderId, newStatus) => {
    try {
        await updateDoc(doc(db, "orders", orderId), {
            status: newStatus
        });
    } catch (err) {
        console.error("Error updating status:", err);
    }
};

// FINANCIALS & REPORTS SECTION
function setupReportDateFilter() {
    const showReportBtn = document.getElementById('btn-show-report');
    const showDaywiseBtn = document.getElementById('btn-show-daywise');

    if (showReportBtn) {
        showReportBtn.addEventListener('click', () => {
            filterFinancialsByDate();
        });
    }

    if (showDaywiseBtn) {
        showDaywiseBtn.addEventListener('click', () => {
            filterFinancialsByDate();
        });
    }
}

function filterFinancialsByDate() {
    const startVal = document.getElementById('report-start-date')?.value;
    const endVal = document.getElementById('report-end-date')?.value;

    let filtered = [...activeOrders];

    if (startVal) {
        const startDate = new Date(startVal);
        startDate.setHours(0,0,0,0);
        filtered = filtered.filter(o => {
            const date = o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : new Date();
            return date >= startDate;
        });
    }

    if (endVal) {
        const endDate = new Date(endVal);
        endDate.setHours(23,59,59,999);
        filtered = filtered.filter(o => {
            const date = o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : new Date();
            return date <= endDate;
        });
    }

    let totalSales = 0, cashSales = 0, onlineSales = 0, pendingAmount = 0;
    filtered.forEach(o => {
        const amt = Number(o.total || 0);
        if (o.paymentStatus === 'Paid') {
            totalSales += amt;
            if (o.paymentMethod === 'Cash') cashSales += amt;
            else onlineSales += amt;
        } else {
            pendingAmount += amt;
        }
    });

    renderFinancialsView(totalSales, cashSales, onlineSales, pendingAmount, filtered.length, filtered);
}

function renderFinancialsView(total, cash, online, pending, totalCount, ordersList) {
    if (!financialsSummaryContainer) return;

    const dailyMap = {};
    (ordersList || []).forEach(o => {
        let dStr = o.createdAt?.seconds 
            ? new Date(o.createdAt.seconds * 1000).toISOString().split('T')[0] 
            : new Date().toISOString().split('T')[0];
        
        if (!dailyMap[dStr]) {
            dailyMap[dStr] = { count: 0, subtotal: 0, discount: 0, total: 0 };
        }
        
        const itemsSubtotal = (o.items || []).reduce((acc, i) => acc + (Number(i.price || 0) * Number(i.qty || 1)), 0);
        dailyMap[dStr].count += 1;
        dailyMap[dStr].subtotal += itemsSubtotal;
        dailyMap[dStr].discount += Number(o.discount || 0);
        dailyMap[dStr].total += Number(o.total || 0);
    });

    let dailyRowsHtml = Object.keys(dailyMap).sort().reverse().map(dateKey => {
        const data = dailyMap[dateKey];
        return `
            <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.85rem;">
                <td style="padding: 8px;">${dateKey}</td>
                <td style="padding: 8px;">${data.count}</td>
                <td style="padding: 8px;">${data.subtotal.toFixed(2)}</td>
                <td style="padding: 8px;">${data.discount.toFixed(2)}</td>
                <td style="padding: 8px; font-weight: bold;">${data.total.toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    financialsSummaryContainer.innerHTML = `
        <div style="background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="margin-bottom: 15px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">
                📊 Monthly Financial Report & Daily Closure
            </h3>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div style="background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <small style="color: #64748b; font-weight: bold;">TOTAL SALES (RECEIVED)</small>
                    <h3 style="margin-top: 5px; color: #0f172a;">RS ${total.toFixed(2)}</h3>
                </div>
                <div style="background: #fffbeb; padding: 12px; border-radius: 6px; border: 1px solid #fde68a;">
                    <small style="color: #b45309; font-weight: bold;">PENDING AMOUNT (LOAN)</small>
                    <h3 style="margin-top: 5px; color: #92400e;">RS ${pending.toFixed(2)}</h3>
                </div>
                <div style="background: #ecfdf5; padding: 12px; border-radius: 6px; border: 1px solid #a7f3d0;">
                    <small style="color: #047857; font-weight: bold;">CASH IN HAND</small>
                    <h3 style="margin-top: 5px; color: #065f46;">RS ${cash.toFixed(2)}</h3>
                </div>
            </div>

            <h4 style="margin-bottom: 10px; color: #374151;">📅 Day-wise Breakdown Summary</h4>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead style="background: #f1f5f9; font-size: 0.8rem; text-transform: uppercase;">
                        <tr>
                            <th style="padding: 8px;">Date</th>
                            <th style="padding: 8px;">Total Orders</th>
                            <th style="padding: 8px;">Gross Subtotal</th>
                            <th style="padding: 8px;">Total Discount</th>
                            <th style="padding: 8px;">Net Sales</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${dailyRowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// INVENTORY MANAGEMENT CONTROL
function initInventoryControl() {
    onSnapshot(collection(db, "menu"), (snapshot) => {
        liveMenuCache = [];
        snapshot.forEach(docSnap => {
            liveMenuCache.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderInventoryList(liveMenuCache);
    });
}

function renderInventoryList(menuItems) {
    if (!inventoryContainer) return;
    inventoryContainer.innerHTML = '';

    menuItems.forEach(item => {
        const itemRow = document.createElement('div');
        itemRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #e5e7eb; background: #fff;";
        
        const isOutOfStock = item.outOfStock || false;

        itemRow.innerHTML = `
            <div>
                <strong>${item.name}</strong> <small style="color: #6b7280;">(${item.category || 'General'})</small>
                <div>PKR ${item.price}</div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="toggleStockStatus('${item.id}', ${!isOutOfStock})" style="background: ${isOutOfStock ? '#ef4444' : '#10b981'}; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">
                    ${isOutOfStock ? 'Sold Out' : 'Available'}
                </button>
                <button onclick="deleteMenuItem('${item.id}')" style="background: #9ca3af; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">🗑️</button>
            </div>
        `;
        inventoryContainer.appendChild(itemRow);
    });
}

window.toggleStockStatus = async (itemId, newStatus) => {
    try {
        await updateDoc(doc(db, "menu", itemId), { outOfStock: newStatus });
    } catch (err) {
        console.error("Error updating menu stock:", err);
    }
};

window.deleteMenuItem = async (itemId) => {
    if (!confirm("Are you sure you want to delete this menu item?")) return;
    try {
        await deleteDoc(doc(db, "menu", itemId));
    } catch (err) {
        console.error("Error deleting menu item:", err);
    }
};

function setupAddItemForm() {
    if (!addItemForm) return;

    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('item-name')?.value;
        const category = document.getElementById('item-category')?.value || 'General';
        const price = parseFloat(document.getElementById('item-price')?.value) || 0;

        if (!name || price <= 0) {
            alert("Please fill valid item name and price.");
            return;
        }

        try {
            const newItemRef = doc(collection(db, "menu"));
            await setDoc(newItemRef, {
                name: name,
                category: category,
                price: price,
                outOfStock: false,
                createdAt: new Date()
            });
            addItemForm.reset();
        } catch (err) {
            console.error("Error adding menu item:", err);
        }
    });
}