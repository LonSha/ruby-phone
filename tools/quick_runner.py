import glob
import subprocess
import concurrent.futures

files = sorted(glob.glob('tests/*.test.mjs'))
failed = []
passed = 0

def run_test(f):
    try:
        res = subprocess.run(['node', '--test', f], capture_output=True, text=True, timeout=15)
        return (f, res.returncode, res.stdout, res.stderr)
    except subprocess.TimeoutExpired:
        return (f, -999, '', 'TIMEOUT')

print(f"Total test files: {len(files)}")
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    futures = [executor.submit(run_test, f) for f in files]
    for future in concurrent.futures.as_completed(futures):
        f, rc, out, err = future.result()
        if rc != 0:
            failed.append((f, rc, out, err))
            print(f"FAILED: {f} (rc={rc})")
        else:
            passed += 1

print("\n" + "="*50)
print(f"SUMMARY: Passed={passed}, Failed={len(failed)}")
print("Failed files:")
for f, rc, out, err in sorted(failed, key=lambda x: x[0]):
    print(f"  {f} (rc={rc})")
