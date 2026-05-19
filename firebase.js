import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; 

// Firebase'den aldığın sana özel kimlik bilgileri
const firebaseConfig = {
  apiKey: "AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY",
  authDomain: "yeniozanlar-68b49.firebaseapp.com",
  projectId: "yeniozanlar-68b49",
  storageBucket: "yeniozanlar-68b49.appspot.com",
  messagingSenderId: "99003509618",
  appId: "1:99003509618:web:e4f36d85378f2e554fcbeb"
};

// Firebase'i başlatıyoruz
const app = initializeApp(firebaseConfig);

// Veritabanını (db) diğer dosyalarda kullanabilmek için dışa aktarıyoruz
export const db = getFirestore(app);