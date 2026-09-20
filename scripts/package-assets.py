import zipfile
import os
import sys

def package_assets(apk_path, public_dir, dex_file=None):
    print(f"[PACKAGE-ASSETS] Adding assets to {apk_path} from {public_dir} with strict forward slashes...")
    with zipfile.ZipFile(apk_path, 'a', compression=zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(public_dir):
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, public_dir).replace('\\', '/')
                zip_entry = 'assets/' + rel_path
                z.write(full_path, arcname=zip_entry)
        
        if dex_file and os.path.exists(dex_file):
            print(f"[PACKAGE-ASSETS] Adding classes.dex from {dex_file}...")
            # classes.dex should preferably be stored uncompressed or standard deflate
            z.write(dex_file, arcname='classes.dex')
    print("[PACKAGE-ASSETS] Done packaging assets with POSIX forward slashes.")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python package-assets.py <apk_path> <public_dir> [dex_file]")
        sys.exit(1)
    apk_path = sys.argv[1]
    public_dir = sys.argv[2]
    dex_file = sys.argv[3] if len(sys.argv) > 3 else None
    package_assets(apk_path, public_dir, dex_file)
