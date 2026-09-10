import { db } from './firebase-config.js';
import { initialMenu } from './menu-data.js';
import { doc, setDoc, getDocs, collection, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Force Sync & Overwrite function
export async function seedMenuToFirestore(showAlert = true) {
    try {
        console.log("Syncing fresh menu to Firestore...");
        
        // 1. Delete existing old items to prevent stale data
        const snap = await getDocs(collection(db, "menu"));
        for (const docItem of snap.docs) {
            await deleteDoc(doc(db, "menu", docItem.id));
        }

        // 2. Upload updated menu items
        for (const item of initialMenu) {
            await setDoc(doc(db, "menu", item.id), item);
        }

        console.log("Menu successfully synced to Firestore!");
        if (showAlert) {
            alert("Menu items successfully updated and synced!");
        }
    } catch (error) {
        console.error("Error seeding menu:", error);
        if (showAlert) {
            alert("Sync error: " + error.message);
        }
    }
}

// Check and Auto-seed / Auto-update if collection is empty or out of date
export async function autoSeedIfEmpty() {
    try {
        const snap = await getDocs(collection(db, "menu"));
        
        // Auto-update if database is empty OR if item count is less than new initialMenu length
        if (snap.empty || snap.docs.length < initialMenu.length) {
            console.log("Updating outdated or empty menu collection...");
            await seedMenuToFirestore(false);
        }
    } catch (err) {
        console.error("Auto seed check failed:", err);
    }
}

// Global expose for Admin Panel button
window.seedMenu = seedMenuToFirestore;