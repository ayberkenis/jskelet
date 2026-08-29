# syntax=docker/dockerfile:1

# Bu örneğin imajı. **Build context'i depo kökü**, Dockerfile'ın kendi dizini
# değil:
#
#   docker build -f examples/marketing/Dockerfile -t jskelet-marketing .
#
# Sebebi `package.json` içindeki `"jskelet": "file:../.."` bağımlılığı. Örnek,
# npm'den değil depodaki framework'ten besleniyor; context yalnızca
# `examples/marketing` olursa o yol context'in dışında kalır ve kurulum
# çözülemez. Coolify/Railpack gibi araçlarda "base directory" olarak `/`,
# Dockerfile konumu olarak da `/examples/marketing/Dockerfile` verilmeli.
#
# Kendi uygulamanızda jskelet normal bir npm bağımlılığı olacağı için bu
# kısıt yok; oradaki çok aşamalı örnek docs/10-dagitim.md içinde.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Bağımlılıklar ayrı katmanda: kaynak değiştiğinde yeniden kurulum olmasın.
COPY package.json package-lock.json ./
COPY examples/marketing/package.json examples/marketing/package-lock.json ./examples/marketing/

# Kökte bilinçli olarak `npm ci` değil: framework'ün lock dosyası yalnızca
# geliştirme araçlarını (eslint) da kapsıyor ve onlar imaja hiç girmediği için
# lock'un tazeliği build'i durdurmamalı. Çalışma zamanı bağımlılıkları
# (`express`, `ejs`, `esbuild`, `tailwind-merge`) `package.json`dan yeterince
# kesin çözülüyor.
RUN npm install --omit=dev --no-audit --no-fund

# Framework kaynağı, örneğin `file:../..` bağımlılığı çözülmeden önce yerinde
# olmak zorunda: npm bu bağımlılık için `node_modules/jskelet` altına bir
# symlink kurar ve hedef dizin yoksa kurulum başarısız olur.
COPY src ./src
COPY bin ./bin

# Tailwind, PostCSS ve lightningcss örneğin devDependency'leri; `--omit=dev`
# verilmez, aksi halde CSS adımı sessizce atlanır ve site stilsiz çıkar.
RUN npm --prefix examples/marketing ci

COPY examples/marketing ./examples/marketing

ENV NODE_ENV=production
RUN npm --prefix examples/marketing run build

# Tek aşama bilinçli: `jskelet` bağımlılığı depo içindeki bir symlink olduğu
# için çalışma aşamasına yalnızca `node_modules`ü kopyalamak bağlantıyı kırar.
# Bunun karşılığında imajda build zamanı bağımlılıkları da kalıyor; gerçek bir
# uygulamada jskelet npm'den geldiği için orada çok aşamalı imaj kurulabilir.
FROM build AS runtime
WORKDIR /app/examples/marketing

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Root olmayan kullanıcı; `node` kullanıcısı temel imajda hazır geliyor.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/api/healthcheck').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `jskelet start` manifest'i bulamazsa build'i kendisi çalıştırır; burada build
# zaten yapıldığı için bu bir no-op.
CMD ["npm", "start"]
