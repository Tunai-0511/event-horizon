# EVENT HORIZON 事件視界

[English](README.md) · **繁體中文**

一支 13 分鐘的黑洞影片，每一個像素都是算出來的。片中沒有 3D 模型、網格、貼圖、圖片檔、字型或文字：

- **光**：沿彎曲的時空逐像素追蹤。
- **落入黑洞的氣體**：來自流體力學模擬。
- **太陽系墜落**：來自 N 體軌道積分。

配樂是 Hans Zimmer〈Interstellar Main Theme〉（Extra Extended 版，12:55）。全片分成六幕，對應樂曲的六輪循環。

| | |
|---|---|
| ![銀河前的暗分子雲](docs/images/01-cloud.jpg) | ![星雲中點燃的大質量恆星](docs/images/02-ignition.jpg) |
| ![超新星](docs/images/03-supernova.jpg) | ![新生黑洞的吸積盤](docs/images/04-disk.jpg) |
| ![被潮汐拉長的類太陽恆星（SPH）](docs/images/05-tidal-disruption.jpg) | ![繞黑洞擺盪的殘骸流（SPH）](docs/images/06-debris.jpg) |
| ![太陽在黑洞背後被扭成光環（N 體）](docs/images/07-sun-lensed.jpg) | ![墜入視界之後：最後的光](docs/images/08-inside-horizon.jpg) |

## 影片內容

| 幕 | 時間 | 內容 |
|---|---|---|
| 一・無垠 | 0:00–2:23 | 第一顆星、銀河、深空裡成千上萬的星系。暗分子雲塌縮成旋轉的盤，大質量恆星點燃 |
| 二・巨星 | 2:23–4:02 | 藍超巨星膨脹成紅超巨星，鐵核長大後塌縮：超新星、光回波、遺骸 |
| 三・誕生 | 4:02–6:25 | 遺骸中的黑洞扭曲了纖維與星光，形成愛因斯坦環。拋射物回落、碰撞、沉降成環，吸積盤往內擴展並點燃 |
| 四・吞噬 | 6:25–8:47 | 類太陽恆星被潮汐撕裂，殘骸一次次繞黑洞擺盪。黑洞長成星系核心的類星體 |
| 五・我們 | 8:47–10:26 | 太陽系墜入 15 億倍太陽質量的黑洞，太陽被扭成光環後吞沒 |
| 六・視界 | 10:26–12:55 | 第一人稱穿過視界：宇宙縮成一圈藍移的光環，再縮成一條線，然後什麼都沒有 |

## 哪些是計算出來的

| | 方法 | 程式 |
|---|---|---|
| 光 | 逐像素積分史瓦西零測地線：在 x'' = −3/2 h² x / r⁵ 上做 RK4，單位 r_s = c = 1。光線本身不畫出來，只呈現它的成像 | `app/shaders/bh.frag` |
| 吸積盤 | 薄盤，T ∝ r^−3/4 (1 − √(r_in/r))^1/4。顏色取經都卜勒與重力紅移後溫度的黑體色，含相對論性集束 | `bh.frag` |
| 觀測者 | 兩種：靜止觀測者（光行差、藍移）；或雨滴座標系的自由落體觀測者，穿過視界仍成立。視界內只能從前方半角 arccos √r 的黑色錐體之外看到天空 | `bh.frag` |
| 星空 | 程序化星場（四層星等）、帶塵埃帶的銀河、深空星系。全部依光線覆蓋範圍濾波，透鏡放大也不會鋸齒 | `app/shaders/sky.glsl` |
| 回落盤（第三幕） | 24,000 粒子的 SPH：理想氣體、人工黏滯、激波熱的輻射冷卻、Paczyński–Wiita 黑洞位勢、3 r_s 內吸積 | `tools/sph/fallback.py` |
| 潮汐瓦解（第四幕） | 32,000 粒子的 SPH：n = 1.5 多方球恆星（M = 10⁻⁶ M_bh、R = 0.236 r_s）在離心軌道上，穿透深度 β = 2；GPU 直接加總自身重力；冷卻 | `tools/sph/tde.py` |
| 太陽系（第五幕） | N 體積分：太陽加八大行星，用真實軌道根數，DOP853 積分。黑洞 1.5×10⁹ M☉，r_s 等於海王星軌道 | `tools/sph/solar.py` |
| 氣體算圖 | 每格把粒子以三次核函數 splat 進兩層巢狀 160³ 體積（密度、溫度、速度），再沿彎曲光線積分發射與吸收，含氣體速度的都卜勒與重力位移 | `app/src/sim.js`、`bh.frag` |
| 星雲、恆星、超新星、星系（第一、二、四幕） | 程序化體積：發射譜線（H-α、[O III]、[S II]）、黑體光球、Lane–Emden 內部結構、對數螺旋臂。有物理依據，但不是流體模擬 | `app/shaders/{nebula,star,nova,galaxy}*` |

光的部分是不自轉黑洞的精確廣義相對論。氣體動力學採用 Paczyński–Wiita 的準牛頓近似。它能重現最內穩定軌道，也能重現讓殘骸流自我交叉的近心點進動。

## 執行方式

需求：
- Node 22 以上
- Google Chrome（以 ANGLE/Metal WebGL2 無頭驅動）
- ffmpeg
- Python 3.12（可用 [uv](https://docs.astral.sh/uv/) 安裝）

本片在 Apple M5 上算圖。

```bash
npm install
uv venv tools/.venv --python 3.12
uv pip install --python tools/.venv/bin/python -r tools/requirements.txt
```

**音樂**：本庫不含配樂。請把自己取得的音檔放在 `audio/src/theme.mp3`，再轉成 WAV：

```bash
ffmpeg -i audio/src/theme.mp3 -ar 44100 -ac 2 audio/theme.wav
```

剪接用的節拍格線與響度曲線已放在 `app/data/`（`audio.json`、`grid.json`）。只有換音樂時才需要用 `tools/analyze.py`、`tools/grid.py` 重新分析。

**模擬**：輸出約 3.5 GB，沒有放進本庫，用下列指令重新產生：

```bash
tools/.venv/bin/python tools/sph/solar.py                                    # 約 1 分鐘
FB_N=24000 FB_TEND=4200 tools/.venv/bin/python tools/sph/fallback.py                     # 約 30 分鐘
TDE_N=32000 tools/.venv/bin/python tools/sph/tde.py relax                    # 約 25 分鐘
TDE_COOL=1.0 TDE_TEND=11500 TDE_DTSNAP=4 tools/.venv/bin/python tools/sph/tde.py run   # 約 2.5 小時
```

**算圖**：

```bash
node tools/render.mjs sheet --pershot --scale 0.3 --spp 2 --tag check     # 每個鏡頭一張的縮圖總表
node tools/render.mjs video --from 360 --to 385 --audio audio/theme.wav --out out/clip.mp4
node tools/render.mjs produce --chunk 20 --final --out out/EventHorizon.mp4  # 整片，可中斷續算
```

`produce` 以 20 秒為一段算到 `out/chunks/`，已經存在的段會跳過：
- 要重算某一段，刪掉那幾段再執行即可。
- 加上 `--final` 會接合各段並混入音樂。
- 整片 1080p30 約 7 小時。每格 4–12 個子幀，用來做動態模糊與反鋸齒；子幀數依鏡頭角速度自動決定。

檢查工具：
- `node tools/cutcheck.mjs`：找跳接。
- `node tools/motion.mjs`：找快速運鏡。
- `tools/.venv/bin/python tools/qa_scan.py out/chunks/*.mp4`：找壞格、全黑或凍結。

## 目錄

```
app/
  src/         引擎（HDR 子幀累積、bloom、ACES／保色相色調映射、溶接）、時間軸、
               shots/act1–6.js（影片本體）、scenes/（各場景的調度）、sim.js（模擬播放）
  shaders/     bh.frag（測地線）、sky.glsl、nebula*、star*、nova.frag、remnant_lib.glsl、galaxy*、post_*
  data/        音樂分析資料；sim/ 存放產生出來的模擬快照
tools/         render.mjs（離線算圖驅動）、sph/（SPH 與 N 體程式）、分析與檢查腳本
docs/          STORYBOARD.md（依小節格線逐鏡分鏡）、BRIEF.md（引擎 API）、scenes/（各場景說明）
```

## 授權

程式與畫面 © 2026 Tunai，保留一切權利，目前沒有採用開源授權。配樂〈Interstellar Main Theme〉作者為 Hans Zimmer，不包含在本庫中。
