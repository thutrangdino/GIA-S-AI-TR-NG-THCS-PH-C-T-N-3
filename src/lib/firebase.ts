import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInAnonymously, 
  onAuthStateChanged, 
  signOut, 
  updateProfile, 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot, orderBy, limit } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export const uploadFile = async (file: File, path: string) => {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
};

export interface StudentData {
  displayName: string;
  xp: number;
  level: string;
  lastActive: any;
  photoURL?: string;
  isAdmin?: boolean;
  streak?: number;
  lastLoginDate?: string;
  badges?: string[];
  completedChallenges?: string[];
}

export const syncStudentData = async (user: User, data?: Partial<StudentData>) => {
  const studentRef = doc(db, "students", user.uid);
  const studentSnap = await getDoc(studentRef);
  const today = new Date().toISOString().split('T')[0];

  // Update Auth Profile if displayName is provided
  if (data?.displayName && user.displayName !== data.displayName) {
    await updateProfile(user, { displayName: data.displayName });
  }

  if (!studentSnap.exists()) {
    const newData: any = {
      displayName: data?.displayName || user.displayName || "Học sinh",
      xp: 0,
      level: "Tập sự",
      lastActive: serverTimestamp(),
      photoURL: user.photoURL || null,
      streak: 1,
      lastLoginDate: today,
      badges: [],
      completedChallenges: []
    };
    await setDoc(studentRef, newData);
    return newData;
  } else {
    const existing = studentSnap.data() as StudentData;
    const updatePayload: any = { lastActive: serverTimestamp() };
    
    // Streak logic
    if (existing.lastLoginDate !== today) {
      const last = existing.lastLoginDate ? new Date(existing.lastLoginDate) : null;
      const current = new Date(today);
      
      if (last) {
        const diffTime = Math.abs(current.getTime() - last.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          updatePayload.streak = (existing.streak || 0) + 1;
        } else {
          updatePayload.streak = 1;
        }
      } else {
        updatePayload.streak = 1;
      }
      updatePayload.lastLoginDate = today;
    }

    if (data?.displayName) updatePayload.displayName = data.displayName;
    if (data?.photoURL) updatePayload.photoURL = data.photoURL;
    if (data?.level) updatePayload.level = data.level;
    if (typeof data?.xp === 'number') updatePayload.xp = data.xp;
    
    await setDoc(studentRef, updatePayload, { merge: true });
    return { ...existing, ...updatePayload } as StudentData;
  }
};

// Helper to convert Name to a valid Email-like username
const nameToEmail = (name: string) => {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^\w\s]/gi, "") // Remove special characters
    .replace(/\s+/g, "_"); // Replace spaces with underscore
  return `${slug}@student.khtn`;
};

export const studentLogin = async (name: string, password: string) => {
  const email = nameToEmail(name);
  
  try {
    // 1. Try signing in
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error: any) {
    // 2. If user doesn't exist, create account
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      // We must check if the name is already taken by a different email (unlikely with our mapping but good to be safe)
      // Actually, in our mapping, name -> email is 1:1. 
      // If sign in fails with 'invalid-credential', it could be wrong password OR user not found.
      
      // Let's try to fetch the student profile to see if it exists
      // Wait, firebase auth doesn't easily expose if email exists without trying to create or sign in.
      
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
        return userCredential.user;
      } catch (createError: any) {
        if (createError.code === 'auth/email-already-in-use') {
          throw new Error("Tên này đã có người sử dụng. Vui lòng nhập đúng mật khẩu hoặc chọn tên khác.");
        }
        throw createError;
      }
    }
    
    if (error.code === 'auth/wrong-password') {
      throw new Error("Mật khẩu không chính xác. Vui lòng thử lại.");
    }
    throw error;
  }
};

export const checkIfAdmin = async (uid: string) => {
  const adminRef = doc(db, "admins", uid);
  const adminSnap = await getDoc(adminRef);
  return adminSnap.exists();
};

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

export function handleFirestoreError(error: any, operationType: FirestoreErrorInfo['operationType'], path: string | null = null) {
  if (error.code === 'permission-denied' || error.message?.includes('insufficient permissions')) {
    const user = auth.currentUser;
    const errorInfo: FirestoreErrorInfo = {
      error: error.message || 'Missing or insufficient permissions',
      operationType,
      path,
      authInfo: {
        userId: user?.uid || 'unauthenticated',
        email: user?.email || '',
        emailVerified: user?.emailVerified || false,
        isAnonymous: user?.isAnonymous || false,
        providerInfo: user?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || ''
        })) || []
      }
    };
    console.error("Firestore Error:", errorInfo);
    throw new Error(JSON.stringify(errorInfo));
  }
  throw error;
}
