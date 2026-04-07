import zipfile, os, sys, json, glob

data_dir = os.path.join(os.path.dirname(__file__), '..', 'NRS国試data')
out_dir = os.path.join(os.path.dirname(__file__), '..', 'pwa-frontend', 'public', 'images', 'questions')
os.makedirs(out_dir, exist_ok=True)

xlsx_files = sorted(glob.glob(os.path.join(data_dir, '*.xlsx')))
print(f'xlsxファイル数: {len(xlsx_files)}')

total_images = 0
image_map = {}

for fpath in xlsx_files:
    fname = os.path.basename(fpath)
    try:
        with zipfile.ZipFile(fpath, 'r') as z:
            media_files = [f for f in z.namelist() if f.startswith('xl/media/')]
            if not media_files:
                continue
            print(f'\n{fname}: {len(media_files)}枚')
            for mf in media_files:
                data = z.read(mf)
                img_name = os.path.basename(mf)
                img_path = os.path.join(out_dir, img_name)
                with open(img_path, 'wb') as f:
                    f.write(data)
                print(f'  {img_name} ({len(data)//1024}KB)')
                total_images += 1

                # ファイル名から問題IDを推測
                import re
                match = re.search(r'nrs_(\d+)_(am|pm)(\d{3})', img_name)
                if match:
                    year = 2000 + int(match.group(1))
                    period = match.group(2)
                    num = match.group(3)
                    question_id = f'{year}_nrs_{match.group(1)}_{period}{num}'
                    image_map[question_id] = img_name
    except Exception as e:
        print(f'エラー: {fname}: {e}')

print(f'\n=== 合計 ===')
print(f'抽出画像数: {total_images}')
print(f'問題リンク数: {len(image_map)}')

# マッピングを保存
map_path = os.path.join(os.path.dirname(__file__), 'output', 'image_map.json')
with open(map_path, 'w') as f:
    json.dump(image_map, f, indent=2, ensure_ascii=False)
print(f'\nimage_map.json を保存しました')

for qid, img in sorted(image_map.items()):
    print(f'  {qid} -> {img}')
