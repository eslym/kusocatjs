export interface EncryptionInterface {
    encrypt(data: string | Buffer): Promise<string>;
    decrypt(data: string): Promise<Buffer>;

    encryptJSON(data: any): Promise<string>;
    decryptJSON<T = any>(data: string): Promise<T>;
}
