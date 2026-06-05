// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// TODO: Replace the placeholder strings below with your actual Firebase config

const firebaseConfig = {
  apiKey: "AIzaSyCD98-PH5qviZEKndC-O40l2mZpSvYDjY8",
  authDomain: "ym-global-software.firebaseapp.com",
  projectId: "ym-global-software",
  storageBucket: "ym-global-software.firebasestorage.app",
  messagingSenderId: "269049700761",
  appId: "1:269049700761:web:7c9bb0197d2700e20f3308",
  measurementId: "G-BXL0CQS40H"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
