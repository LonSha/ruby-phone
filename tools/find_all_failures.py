import glob
import subprocess
import sys

files = sorted(glob.glob('tests/*.test.mjs'))
failed = []
passed = 0

print(f"Scanning {len(files)} test files sequentially...")
for i, f in enumerate(files):
    # 每50个输出一次进度
    if i % 50 == 0 and i > 0:
        print(f"[{i}/{len(files)}] passed: {passed}, failed: {len(failed)}")
    try:
        res = subprocess.run(['node', '--test', f], capture_output=True, text=True, timeout=20)
        if res.returncode != 0:
            failed.append((f, res.returncode, res.stdout, res.stderr))
            print(f"  FAIL -> {f}")
        else:
            passed += 1
    except subprocess.TimeoutExpired:
        failed.append((f, -999, '', 'TIMEOUT (20s)'))
        print(f"  TIMEOUT -> {f}")

print("\n" + "="*50)
print(f"FINAL RESULT: Passed={passed}, Failed={len(failed)}")
if failed:
    print("Failed test files:")
    for f, rc, out, err in failed:
        print(f"  {f} (rc={rc})")