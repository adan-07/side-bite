import { db } from './firebase-config.js';
import { 
    collection, 
    doc, 
    getDoc, 
    updateDoc, 
    setDoc,
    runTransaction, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Global Cart State
let cart = [];

// Functions Ko Dynamic Access Ke Liye Window Context Par Attach Karein
window.updateQuantity = (index, change) => {
    if (!cart[index]) return;
    cart[index].qty += change;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    saveAndRender();
};

window.removeItem = (index) => {
    cart.splice(index, 1);
    saveAndRender();
};

window.updateNotes = (index, val) => {
    if (cart[index]) {
        cart[index].notes = val.trim();
        localStorage.setItem('cafe_cart', JSON.stringify(cart));
    }
};

function saveAndRender() {
    localStorage.setItem('cafe_cart', JSON.stringify(cart));
    renderCart();
}

function renderCart() {
    const cartListContainer = document.getElementById('cart-list');
    const cartTotalElement = document.getElementById('cart-total');
    const submitBtn = document.getElementById('submit-order-btn');

    if (!cartListContainer) return;

    cartListContainer.innerHTML = '';

    if (!cart || cart.length === 0) {
        cartListContainer.innerHTML = `
            <div style="text-align: center; padding: 25px 0;">
                <p style="color: #64748b; font-size: 1.1rem; margin-bottom: 10px;">Aap ka cart khaali hai!</p>
                <a href="index.html" style="color: #1d3557; font-weight: bold; text-decoration: underline;">← Menu par wapis jayein</a>
            </div>
        `;
        if (cartTotalElement) cartTotalElement.textContent = '0';
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    if (submitBtn) submitBtn.disabled = false;
    let total = 0;

    cart.forEach((item, index) => {
        const itemTotal = Number(item.price) * Number(item.qty || 1);
        total += itemTotal;

        const card = document.createElement('div');
        card.style.cssText = "border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 15px; background: #fff;";
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div>
                    <h4 style="margin: 0; font-size: 1.1rem; color: #0f172a;">${item.name}</h4>
                </div>
                <div style="text-align: right;">
                    <span style="font-weight: bold; color: #e63946; font-size: 1.1rem;">PKR ${itemTotal}</span>
                    <div>
                        <button type="button" onclick="removeItem(${index})" style="background: none; border: none; color: #ef4444; font-size: 0.85rem; cursor: pointer; padding: 4px 0 0 0; text-decoration: underline;">Remove</button>
                    </div>
                </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                <button type="button" class="qty-btn" onclick="updateQuantity(${index}, -1)" style="padding: 4px 12px; font-size: 0.9rem;">-</button>
                <span style="font-weight: bold; font-size: 0.95rem;">Qty: ${item.qty}</span>
                <button type="button" class="qty-btn" onclick="updateQuantity(${index}, 1)" style="padding: 4px 12px; font-size: 0.9rem;">+</button>
            </div>

            <div>
                <input 
                    type="text" 
                    class="form-control" 
                    placeholder="Customization (e.g. Extra Cheese, No Olives)" 
                    value="${item.notes || ''}" 
                    onchange="updateNotes(${index}, this.value)"
                    style="font-size: 0.9rem; padding: 8px 12px;"
                >
            </div>
        `;

        cartListContainer.appendChild(card);
    });

    if (cartTotalElement) {
        cartTotalElement.textContent = total;
    }
}

// Main Execution Init
function initCartApp() {
    try {
        cart = JSON.parse(localStorage.getItem('cafe_cart')) || [];
    } catch (e) {
        cart = [];
    }

    renderCart();

    const paymentSelect = document.getElementById('payment-method');
    const phoneFieldGroup = document.getElementById('phone-field-group');
    const phoneInput = document.getElementById('customer-phone');

    function handlePaymentChange() {
        if (!paymentSelect || !phoneFieldGroup) return;
        const val = paymentSelect.value;
        if (val.includes('Loan') || val.includes('Cash on Delivery')) {
            phoneFieldGroup.style.display = 'block';
            if (phoneInput) phoneInput.required = true;
        } else {
            phoneFieldGroup.style.display = 'none';
            if (phoneInput) {
                phoneInput.required = false;
                phoneInput.value = '';
            }
        }
    }

    if (paymentSelect) {
        paymentSelect.addEventListener('change', handlePaymentChange);
        handlePaymentChange();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const appendOrderId = urlParams.get('append_to');

    if (appendOrderId) {
        getDoc(doc(db, "orders", appendOrderId)).then(docSnap => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (document.getElementById('customer-name')) document.getElementById('customer-name').value = data.customerName || '';
                if (document.getElementById('table-no')) document.getElementById('table-no').value = data.tableNo || '';
                if (paymentSelect) paymentSelect.value = data.paymentMethod || paymentSelect.value;
                if (phoneInput && data.customerPhone) phoneInput.value = data.customerPhone;
                handlePaymentChange();
            }
        }).catch(err => console.error(err));
    }

    const orderForm = document.getElementById('order-form');
    const submitBtn = document.getElementById('submit-order-btn');

    if (orderForm) {
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (cart.length === 0) {
                alert("Aap ka cart khaali hai!");
                return;
            }

            const customerName = document.getElementById('customer-name').value.trim();
            const tableNo = document.getElementById('table-no').value.trim();
            const paymentMethod = paymentSelect ? paymentSelect.value : 'Cash';
            const customerPhone = phoneInput ? phoneInput.value.trim() : '';

            if ((paymentMethod.includes('Loan') || paymentMethod.includes('Cash on Delivery')) && !customerPhone) {
                alert("Is payment method ke liye Phone Number zaroori hai!");
                return;
            }

            if (!customerName || !tableNo) {
                alert("Meharbani karke required fields fill karein.");
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Order Processing...';
            }

            const calculatedTotal = cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty || 1)), 0);

            const newItems = cart.map(item => ({
                id: item.id || '',
                name: item.name,
                price: Number(item.price),
                qty: Number(item.qty || 1),
                notes: item.notes || ''
            }));

            try {
                let finalOrderId;

                if (appendOrderId) {
                    const docRef = doc(db, "orders", appendOrderId);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        const existingData = docSnap.data();
                        const combinedItems = [...(existingData.items || []), ...newItems];
                        const updatedTotal = Number(existingData.total || 0) + calculatedTotal;

                        await updateDoc(docRef, {
                            items: combinedItems,
                            total: updatedTotal
                        });

                        finalOrderId = appendOrderId;
                    } else {
                        finalOrderId = await createNewOrderWithToken({
                            customerName, 
                            customerPhone: customerPhone || 'N/A', 
                            tableNo, 
                            paymentMethod,
                            paymentStatus: 'Unpaid', 
                            status: 'Pending', 
                            items: newItems, 
                            total: calculatedTotal
                        });
                    }
                } else {
                    finalOrderId = await createNewOrderWithToken({
                        customerName, 
                        customerPhone: customerPhone || 'N/A', 
                        tableNo, 
                        paymentMethod,
                        paymentStatus: 'Unpaid', 
                        status: 'Pending', 
                        items: newItems, 
                        total: calculatedTotal
                    });
                }

                localStorage.removeItem('cafe_cart');
                localStorage.setItem('active_order_id', finalOrderId);

                window.location.href = `order-status.html?id=${finalOrderId}`;

            } catch (error) {
                console.error("Error submitting order: ", error);
                alert("Order place karne me masala aaya: " + error.message);
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Confirm & Place Order';
                }
            }
        });
    }
}

// Transaction Engine for Token Generation
async function createNewOrderWithToken(orderData) {
    const counterRef = doc(db, "counters", "dailyOrderCounter");
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    let createdDocId = null;

    try {
        await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            let nextToken = 101;

            if (counterDoc.exists()) {
                const data = counterDoc.data();
                if (data.lastDate === todayStr) {
                    nextToken = (Number(data.lastToken) || 100) + 1;
                }
            }

            transaction.set(counterRef, { 
                lastToken: nextToken, 
                lastDate: todayStr 
            }, { merge: true });

            const newOrderRef = doc(collection(db, "orders"));
            createdDocId = newOrderRef.id;

            transaction.set(newOrderRef, {
                ...orderData,
                tokenNo: nextToken,
                orderDateStr: todayStr,
                createdAt: serverTimestamp()
            });
        });

        return createdDocId;
    } catch (err) {
        console.error("Transaction failed, fallback applied:", err);
        const fallbackOrderRef = doc(collection(db, "orders"));
        
        await setDoc(fallbackOrderRef, {
            ...orderData,
            tokenNo: 101,
            orderDateStr: todayStr,
            createdAt: serverTimestamp()
        });
        
        return fallbackOrderRef.id;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCartApp);
} else {
    initCartApp();
}