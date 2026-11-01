import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
    query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/* ==========================================================
   Security model
   - Data lives at users/<uid>/bookmarks (see firestore.rules)
   - Cards are built with DOM APIs (textContent), never innerHTML
   - Only http(s) URLs are accepted and rendered as links
   ========================================================== */

// Firebase web config is public by design; the rules protect the data.
const firebaseConfig = {
    apiKey: "AIzaSyCxA9CtSkgdnZDi1shlAxlYyv9wKnWS7sE",
    authDomain: "bookmark-manager-63820.firebaseapp.com",
    projectId: "bookmark-manager-63820",
    storageBucket: "bookmark-manager-63820.firebasestorage.app",
    messagingSenderId: "373913303272",
    appId: "1:373913303272:web:61b107b40a8ef893d0b15d",
    measurementId: "G-D0JRJEFX4N"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CATEGORIES = {
    general: 'General',
    work: '💼 Work',
    personal: '🏠 Personal',
    learning: '📚 Learning'
};

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const authSection = $('auth-section');
const appContent = $('app-content');
const authError = $('auth-error');
const signinBtn = $('signin-btn');
const signoutBtn = $('signout-btn');
const userChip = $('user-chip');
const userAvatar = $('user-avatar');
const userName = $('user-name');
const form = $('bookmark-form');
const addBtn = $('add-btn');
const cancelBtn = $('cancel-btn');
const siteNameInput = $('site-name');
const siteUrlInput = $('site-url');
const siteCategoryInput = $('site-category');
const formTitle = $('add-bookmark-title');
const searchInput = $('search-input');
const filterBar = $('filter-bar');
const container = $('bookmarks-container');
const countBadge = $('count-badge');
const exportBtn = $('export-btn');
const themeToggleBtn = $('theme-toggle');
const toastEl = $('toast');

// ---------- State ----------
let currentUser = null;
let unsubscribe = null;
let bookmarksLocal = [];
let activeCategory = 'all';
let isEditing = false;
let currentEditId = null;

$('year').textContent = new Date().getFullYear();

// ---------- Small helpers ----------
// Build DOM nodes safely: text always goes through textContent
function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
    }
    kids.forEach(c => node.append(c));
    return node;
}
const icon = cls => h('i', { class: cls, 'aria-hidden': 'true' });

// Returns a clean http(s) URL string, or null if it is not acceptable
function normalizeUrl(raw) {
    let v = String(raw || '').trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) {
        if (/^(javascript|data|vbscript|file|blob|about):/i.test(v)) return null;
        v = 'https://' + v;
    }
    try {
        const u = new URL(v);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
        return u.href;
    } catch { return null; }
}

const sameUrl = (a, b) => String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();

let toastTimer;
function toast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------- Theme ----------
if ((localStorage.getItem('theme') || 'light') === 'dark') {
    document.body.classList.add('dark-theme');
    themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
}
themeToggleBtn.addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark-theme');
    themeToggleBtn.innerHTML = dark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
});

// ---------- Auth ----------
function showAuthError(msg) {
    authError.textContent = msg;
    authError.hidden = !msg;
}

signinBtn.addEventListener('click', async () => {
    showAuthError('');
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
        console.warn('Sign-in failed:', err.code);
        if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
        if (err.code === 'auth/unauthorized-domain') {
            showAuthError('This domain is not authorized. Add it in Firebase → Authentication → Settings → Authorized domains.');
        } else if (err.code === 'auth/operation-not-allowed') {
            showAuthError('Google sign-in is not enabled in Firebase yet.');
        } else if (err.code === 'auth/popup-blocked') {
            showAuthError('Your browser blocked the sign-in popup. Allow popups for this site and try again.');
        } else {
            showAuthError('Could not sign in. Try again.');
        }
    }
});

signoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, user => {
    currentUser = user;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    if (!user) {
        bookmarksLocal = [];
        searchInput.value = '';
        cancelEdit();
        container.replaceChildren();
        appContent.hidden = true;
        userChip.hidden = true;
        authSection.hidden = false;
        return;
    }

    authSection.hidden = true;
    appContent.hidden = false;
    userChip.hidden = false;
    userName.textContent = user.displayName || user.email || 'Signed in';
    if (user.photoURL) userAvatar.src = user.photoURL; else userAvatar.removeAttribute('src');

    const q = query(collection(db, 'users', user.uid, 'bookmarks'), orderBy('createdAt', 'desc'));
    unsubscribe = onSnapshot(q, snap => {
        bookmarksLocal = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBookmarks();
    }, err => {
        console.error('Error fetching bookmarks:', err.code);
        toast('Cannot load bookmarks. Check Firestore rules.');
    });
});

const userCol = () => collection(db, 'users', currentUser.uid, 'bookmarks');
const userDoc = id => doc(db, 'users', currentUser.uid, 'bookmarks', id);

// ---------- Render ----------
function timeOf(bm) {
    return bm.createdAt && bm.createdAt.toMillis ? bm.createdAt.toMillis() : Date.now(); // pending write
}

function renderBookmarks() {
    const term = searchInput.value.trim().toLowerCase();

    let list = bookmarksLocal.filter(bm => {
        const cat = bm.category || 'general';
        if (activeCategory !== 'all' && cat !== activeCategory) return false;
        if (!term) return true;
        return String(bm.name || '').toLowerCase().includes(term) ||
            String(bm.url || '').toLowerCase().includes(term) ||
            cat.includes(term);
    });

    // Pinned first, then newest first
    list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || timeOf(b) - timeOf(a));

    countBadge.textContent = list.length;
    container.replaceChildren();

    if (list.length === 0) {
        const msg = bookmarksLocal.length === 0
            ? 'No bookmarks yet. Add your first one above.'
            : 'No bookmarks match your search.';
        container.append(h('p', { class: 'helper-text empty-state', text: msg }));
        return;
    }

    list.forEach(bm => container.append(buildCard(bm)));
}

function buildCard(bm) {
    const cat = CATEGORIES[bm.category] ? bm.category : 'general';
    const name = String(bm.name || '');
    const url = normalizeUrl(bm.url); // re-check on render, never trust stored data

    const visit = url
        ? h('a', {
            class: 'btn btn-visit', href: url, target: '_blank', rel: 'noopener noreferrer',
            title: 'Open this link in a new tab', 'aria-label': 'Visit ' + name
        }, icon('fa-solid fa-arrow-up-right-from-square'), ' Visit')
        : h('span', { class: 'btn btn-visit disabled', title: 'Invalid link' }, icon('fa-solid fa-ban'), ' Invalid');

    const pin = h('button', {
        class: 'btn btn-pin' + (bm.pinned ? ' active' : ''), type: 'button',
        title: bm.pinned ? 'Unpin' : 'Pin to top', 'aria-label': bm.pinned ? 'Unpin bookmark' : 'Pin bookmark',
        'aria-pressed': String(!!bm.pinned), onclick: () => togglePin(bm)
    }, icon('fa-solid fa-star'));

    const edit = h('button', {
        class: 'btn btn-edit', type: 'button', title: 'Edit the details of this bookmark',
        'aria-label': 'Edit bookmark', onclick: () => startEdit(bm.id)
    }, icon('fa-solid fa-pen'), ' Edit');

    const del = h('button', {
        class: 'btn btn-delete', type: 'button', title: 'Permanently delete this bookmark',
        'aria-label': 'Delete bookmark', onclick: () => deleteBookmark(bm.id)
    }, icon('fa-solid fa-trash'), ' Delete');

    return h('article', { class: 'bookmark-card' + (bm.pinned ? ' pinned' : '') },
        h('div', { class: 'card-content' },
            h('span', { class: 'badge badge-' + cat, text: CATEGORIES[cat] }),
            h('h3', { class: 'bookmark-title', title: name, text: name }),
            h('p', { class: 'bookmark-url', title: bm.url || '', text: bm.url || '' })
        ),
        h('div', { class: 'card-actions' }, visit, pin, edit, del)
    );
}

// ---------- Search + category filter ----------
searchInput.addEventListener('input', renderBookmarks);

filterBar.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    activeCategory = chip.dataset.cat;
    filterBar.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    renderBookmarks();
});

// ---------- Create / update ----------
form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentUser) return;

    const name = siteNameInput.value.trim();
    const url = normalizeUrl(siteUrlInput.value);
    const category = CATEGORIES[siteCategoryInput.value] ? siteCategoryInput.value : 'general';

    if (!name) return toast('Enter a website name.');
    if (!url) return toast('Enter a valid website address (http or https).');

    const dup = bookmarksLocal.find(b => b.id !== currentEditId && sameUrl(b.url, url));
    if (dup) return toast(`Already saved as "${dup.name}".`);

    addBtn.disabled = true;
    addBtn.replaceChildren(icon('fa-solid fa-spinner fa-spin'), ' Saving...');

    try {
        if (isEditing) {
            await updateDoc(userDoc(currentEditId), { name, url, category, updatedAt: serverTimestamp() });
            toast('Bookmark updated.');
            cancelEdit();
        } else {
            await addDoc(userCol(), { name, url, category, pinned: false, createdAt: serverTimestamp() });
            toast('Bookmark added.');
            form.reset();
            siteNameInput.focus();
        }
    } catch (err) {
        console.error('Save failed:', err.code);
        toast('Could not save. Check your connection and try again.');
    } finally {
        addBtn.disabled = false;
        setFormMode();
    }
});

function setFormMode() {
    if (isEditing) {
        addBtn.replaceChildren(icon('fa-solid fa-save'), ' Save Changes');
        addBtn.classList.replace('btn-primary', 'btn-success');
        cancelBtn.hidden = false;
        formTitle.textContent = 'Edit Bookmark';
    } else {
        addBtn.replaceChildren(icon('fa-solid fa-plus'), ' Add Bookmark');
        addBtn.classList.replace('btn-success', 'btn-primary');
        cancelBtn.hidden = true;
        formTitle.textContent = 'Add New Bookmark';
    }
}

function startEdit(id) {
    const bm = bookmarksLocal.find(b => b.id === id);
    if (!bm) return;
    siteNameInput.value = bm.name || '';
    siteUrlInput.value = bm.url || '';
    siteCategoryInput.value = CATEGORIES[bm.category] ? bm.category : 'general';
    isEditing = true;
    currentEditId = id;
    setFormMode();
    document.querySelector('.add-bookmark-section').scrollIntoView({ behavior: 'smooth' });
    siteNameInput.focus();
}

function cancelEdit() {
    isEditing = false;
    currentEditId = null;
    form.reset();
    setFormMode();
}
cancelBtn.addEventListener('click', cancelEdit);

// ---------- Pin / delete / export ----------
async function togglePin(bm) {
    try {
        await updateDoc(userDoc(bm.id), { pinned: !bm.pinned, updatedAt: serverTimestamp() });
    } catch (err) {
        console.error('Pin failed:', err.code);
        toast('Could not update the pin.');
    }
}

async function deleteBookmark(id) {
    if (!confirm('Are you sure you want to delete this bookmark?')) return;
    try {
        await deleteDoc(userDoc(id));
        if (isEditing && currentEditId === id) cancelEdit();
        toast('Bookmark deleted.');
    } catch (err) {
        console.error('Delete failed:', err.code);
        toast('Could not delete the bookmark.');
    }
}

exportBtn.addEventListener('click', () => {
    if (!bookmarksLocal.length) return toast('Nothing to export yet.');
    const data = bookmarksLocal.map(({ name, url, category, pinned }) => ({
        name, url, category: category || 'general', pinned: !!pinned
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'bookmarks.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
