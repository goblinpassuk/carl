// ============================================================
// YubiKey Encrypted Notes - WebAuthn + AES-GCM
// Stores encrypted data in localStorage, export to encrypted file
// ============================================================

class YubiKeyEncryptedNotes {
    constructor() {
        this.currentUserId = null;
        this.currentKey = null;  // CryptoKey derived from YubiKey assertion
        this.storageKey = 'yubikey_encrypted_notes';
    }

    showStatus(msg, type = 'info') {
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = msg;
        statusDiv.className = `status ${type}`;
        setTimeout(() => {
            if (statusDiv.textContent === msg) {
                statusDiv.className = 'status hidden';
            }
        }, 4000);
    }

    async generateChallenge() {
        // Simple random challenge for demo. In production, use server-generated.
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        return challenge;
    }

    async registerYubiKey() {
        try {
            const challenge = await this.generateChallenge();
            const userId = crypto.randomUUID();
            
            const publicKeyCredentialCreationOptions = {
                challenge: challenge,
                rp: { name: "YubiKey Notes", id: window.location.hostname },
                user: {
                    id: new TextEncoder().encode(userId),
                    name: "notes-user",
                    displayName: "Notes User"
                },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }],  // ES256
                authenticatorSelection: {
                    authenticatorAttachment: "cross-platform",  // YubiKey typically
                    requireResidentKey: false,
                    userVerification: "required"
                },
                timeout: 60000,
                attestation: "none"
            };

            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            });

            // Store credential ID and user ID
            localStorage.setItem('yubikey_credential_id', 
                btoa(String.fromCharCode(...new Uint8Array(credential.rawId))));
            localStorage.setItem('yubikey_user_id', userId);
            
            this.showStatus('✅ YubiKey registered successfully!', 'success');
            return true;
        } catch (err) {
            console.error('Registration error:', err);
            this.showStatus(`Registration failed: ${err.message}`, 'error');
            return false;
        }
    }

    async authenticateWithYubiKey() {
        const storedCredId = localStorage.getItem('yubikey_credential_id');
        if (!storedCredId) {
            this.showStatus('No registered YubiKey found. Please register first.', 'error');
            return null;
        }

        try {
            const challenge = await this.generateChallenge();
            const credentialId = Uint8Array.from(atob(storedCredId), c => c.charCodeAt(0));

            const publicKeyCredentialRequestOptions = {
                challenge: challenge,
                allowCredentials: [{
                    id: credentialId,
                    type: "public-key",
                    transports: ["usb", "nfc", "ble"]
                }],
                timeout: 60000,
                userVerification: "required"
            };

            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            });

            // Derive encryption key from the authenticator data + signature
            // This binds the encryption to this specific YubiKey authentication
            const authData = assertion.response.authenticatorData;
            const signature = assertion.response.signature;
            
            // Combine for key material (simplified - in production use proper KDF)
            const keyMaterial = await crypto.subtle.digest('SHA-256', 
                new Uint8Array([...new Uint8Array(authData), ...new Uint8Array(signature)]));
            
            const cryptoKey = await crypto.subtle.importKey(
                'raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
            );
            
            this.currentKey = cryptoKey;
            this.currentUserId = localStorage.getItem('yubikey_user_id');
            
            this.showStatus('✅ YubiKey authentication successful!', 'success');
            return cryptoKey;
        } catch (err) {
            console.error('Authentication error:', err);
            this.showStatus(`Authentication failed: ${err.message}`, 'error');
            return null;
        }
    }

    async encryptData(text, key) {
        const encoder = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encodedData = encoder.encode(text);
        
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encodedData
        );
        
        return {
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        };
    }

    async decryptData(encryptedObj, key) {
        const decoder = new TextDecoder();
        const iv = new Uint8Array(encryptedObj.iv);
        const data = new Uint8Array(encryptedObj.data);
        
        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                data
            );
            return decoder.decode(decrypted);
        } catch (err) {
            console.error('Decryption failed:', err);
            return null;
        }
    }

    async saveNotes(text) {
        if (!this.currentKey) {
            this.showStatus('Please authenticate with YubiKey first', 'error');
            return false;
        }
        
        const encrypted = await this.encryptData(text, this.currentKey);
        localStorage.setItem(this.storageKey, JSON.stringify(encrypted));
        this.showStatus('Notes saved and encrypted locally', 'success');
        return true;
    }

    async loadNotes() {
        if (!this.currentKey) {
            this.showStatus('Please authenticate with YubiKey first', 'error');
            return null;
        }
        
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
            return '';
        }
        
        try {
            const encrypted = JSON.parse(stored);
            const decrypted = await this.decryptData(encrypted, this.currentKey);
            return decrypted;
        } catch (err) {
            this.showStatus('Failed to decrypt notes', 'error');
            return null;
        }
    }

    async exportToFile() {
        if (!this.currentKey) {
            this.showStatus('Authenticate with YubiKey to export', 'error');
            return;
        }
        
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
            this.showStatus('No saved notes to export', 'info');
            return;
        }
        
        // Export the encrypted blob directly (already encrypted)
        const encrypted = JSON.parse(stored);
        const jsonStr = JSON.stringify(encrypted, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `yubikey_notes_${Date.now()}.encrypted.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showStatus('Encrypted notes exported to file', 'success');
    }

    async importFromFile(file) {
        if (!this.currentKey) {
            this.showStatus('Authenticate with YubiKey to import', 'error');
            return false;
        }
        
        try {
            const text = await file.text();
            const encrypted = JSON.parse(text);
            
            // Verify it's valid encrypted data
            if (!encrypted.iv || !encrypted.data) {
                throw new Error('Invalid encrypted file format');
            }
            
            // Test decrypt to verify key works
            const testDecrypt = await this.decryptData(encrypted, this.currentKey);
            if (testDecrypt === null) {
                throw new Error('Cannot decrypt with current YubiKey');
            }
            
            localStorage.setItem(this.storageKey, JSON.stringify(encrypted));
            this.showStatus('Imported encrypted notes successfully', 'success');
            return true;
        } catch (err) {
            this.showStatus(`Import failed: ${err.message}`, 'error');
            return false;
        }
    }
    
    lock() {
        this.currentKey = null;
        this.currentUserId = null;
        document.getElementById('noteContent').value = '';
        document.getElementById('notesSection').classList.add('hidden');
        document.getElementById('authSection').classList.remove('hidden');
        this.showStatus('Locked. Use YubiKey to unlock again.', 'info');
    }
    
    async unlock() {
        const key = await this.authenticateWithYubiKey();
        if (key) {
            document.getElementById('authSection').classList.add('hidden');
            document.getElementById('notesSection').classList.remove('hidden');
            
            const notes = await this.loadNotes();
            if (notes !== null) {
                document.getElementById('noteContent').value = notes || '';
            }
        }
    }
}

// Initialize the app
const app = new YubiKeyEncryptedNotes();

// Setup event listeners when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('registerBtn').addEventListener('click', () => app.registerYubiKey());
    document.getElementById('loginBtn').addEventListener('click', () => app.unlock());
    document.getElementById('saveBtn').addEventListener('click', async () => {
        const content = document.getElementById('noteContent').value;
        await app.saveNotes(content);
    });
    document.getElementById('exportBtn').addEventListener('click', () => app.exportToFile());
    document.getElementById('lockBtn').addEventListener('click', () => app.lock());
    
    // Optional import (add your own UI for this)
    console.log('Ready - Register a YubiKey first, then use it to unlock');
});