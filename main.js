// main.js
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
} from "firebase/firestore";
// ———— Auth‐State & Role Guard ————
const loginSection = document.getElementById("loginSection");
const adminSection = document.getElementById("adminSection");

// Hide both sections until we know who’s logged in
loginSection.style.display = "none";
adminSection.style.display = "none";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not signed in → show login only
    loginSection.style.display = "";
    adminSection.style.display = "none";
    return;
  }
  // Signed in → fetch their profile doc
  const snap = await getDoc(doc(db, "users", user.uid));
  const data = snap.data() || {};

  if (data.role === "Admin") {
    // Admin → show admin UI
    loginSection.style.display = "none";
    adminSection.style.display = "";
  } else {
    // Not an admin → block access
    alert("You are not authorized to view this page.");
    await signOut(auth);
    loginSection.style.display = "";
    adminSection.style.display = "none";
  }
});


// ———— Login Elements ————
const emailEl    = document.getElementById('email');
const passEl     = document.getElementById('password');
const btnLogin   = document.getElementById('btnLogin');
const statusEl   = document.getElementById('status');

// ———— Add-User Elements ————
const fullNameEl   = document.getElementById('fullName');
const newEmailEl   = document.getElementById('newEmail');
const newPassEl    = document.getElementById('newPassword');
const roleEl       = document.getElementById('role');
const brandsEl     = document.getElementById('brands');
const btnAddUser   = document.getElementById('btnAddUser');
const addStatusEl  = document.getElementById('addStatus');

// ———— Login Handler ————
btnLogin.addEventListener('click', async () => {
  const email = emailEl.value;
  const pass = passEl.value;
  statusEl.textContent = 'Logging in…';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    statusEl.textContent = '✅ Logged in!';
    // Optionally show the Add-User form now…
    document.querySelector('hr').style.display = 'block';
    document.querySelector('h2').style.display = 'block';
  } catch (err) {
    console.error(err);
    statusEl.textContent = `❌ ${err.message}`;
  }
});

// ———— Add-User Handler ————
btnAddUser.addEventListener('click', async () => {
  const fullName = fullNameEl.value;
  const email    = newEmailEl.value;
  const pass     = newPassEl.value;
  const role     = roleEl.value;
  const brands   = brandsEl.value.split(',').map(b => b.trim());

  addStatusEl.textContent = 'Adding user…';
  try {
    // 1) Create Auth user
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;

    // 2) Save profile in Firestore
    // 2) Save profile in Firestore under their UID
await setDoc(doc(db, 'users', uid), {
  fullName,
  email,
  role,
  brands,
  isActive: true,
  createdAt: new Date()
});


    addStatusEl.textContent = '✅ User added!';
    // Clear form
    fullNameEl.value = '';
    newEmailEl.value = '';
    newPassEl.value = '';
    roleEl.value = '';
    brandsEl.value = '';
  } catch (err) {
    console.error(err);
    addStatusEl.textContent = `❌ ${err.message}`;
  }
});
import { collection, onSnapshot, updateDoc, deleteDoc, doc } from 'firebase/firestore';

// ———— Populate Team Members Table ————
const tableBody = document.querySelector('#usersTable tbody');

onSnapshot(collection(db, 'users'), snapshot => {
  tableBody.innerHTML = ''; // clear old rows
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const tr = document.createElement('tr');

    // Name, Email, Role, Brands
    tr.innerHTML = `
      <td>${data.fullName}</td>
      <td>${data.email}</td>
      <td>${data.role}</td>
      <td>${(data.brands || []).join(', ')}</td>
      <td>${data.isActive ? 'Active' : 'Inactive'}</td>
      <td>
        <button class="toggle-btn">${data.isActive ? 'Deactivate' : 'Activate'}</button>
        <button class="delete-btn">Delete</button>
      </td>
    `;

    // Toggle Active/Inactive
    tr.querySelector('.toggle-btn').addEventListener('click', async () => {
      await updateDoc(doc(db, 'users', docSnap.id), {
        isActive: !data.isActive
      });
    });

    // Delete User
    tr.querySelector('.delete-btn').addEventListener('click', async () => {
      if (confirm(`Delete ${data.fullName}? This cannot be undone.`)) {
        await deleteDoc(doc(db, 'users', docSnap.id));
      }
    });

    tableBody.appendChild(tr);
  });
});
