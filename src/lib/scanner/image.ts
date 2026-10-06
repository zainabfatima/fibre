import type { PageChecks, Point, ScanFilter } from "@/lib/scanner/types"

export function luminance(data: Uint8ClampedArray, index: number) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
}

export function detectCorners(image: ImageData): Point[] {
  const { width, height, data } = image
  const step = Math.max(1, Math.floor(Math.min(width, height) / 240))
  let sum = 0
  let count = 0
  for (let y = 0; y < height; y += step * 4) {
    for (let x = 0; x < width; x += step * 4) {
      sum += luminance(data, (y * width + x) * 4)
      count += 1
    }
  }
  const threshold = Math.min(210, sum / Math.max(count, 1) + 18)
  let best: Point[] = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ]
  let bestScore = Infinity
  const candidates: Point[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (luminance(data, (y * width + x) * 4) >= threshold) candidates.push({ x, y })
    }
  }
  if (candidates.length < 40) return best
  const scoreOf = (point: Point, ax: number, ay: number) => point.x * ax + point.y * ay
  const pick = (ax: number, ay: number) =>
    candidates.reduce((chosen, point) => (scoreOf(point, ax, ay) > scoreOf(chosen, ax, ay) ? point : chosen))
  const corners = [pick(-1, -1), pick(1, -1), pick(1, 1), pick(-1, 1)]
  const area = polygonArea(corners)
  if (area > width * height * 0.08) {
    best = corners
    bestScore = area
  }
  return bestScore === Infinity ? best : best
}

function polygonArea(points: Point[]) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    sum += points[index].x * next.y - next.x * points[index].y
  }
  return Math.abs(sum) / 2
}

function solve(matrix: number[][], values: number[]) {
  const size = values.length
  const rows = matrix.map((row, index) => [...row, values[index]])
  for (let col = 0; col < size; col += 1) {
    let pivot = col
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row
    }
    if (Math.abs(rows[pivot][col]) < 1e-8) return null
    ;[rows[col], rows[pivot]] = [rows[pivot], rows[col]]
    const divisor = rows[col][col]
    for (let cell = col; cell <= size; cell += 1) rows[col][cell] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue
      const factor = rows[row][col]
      for (let cell = col; cell <= size; cell += 1) rows[row][cell] -= factor * rows[col][cell]
    }
  }
  return rows.map((row) => row[size])
}

function homography(from: Point[], to: Point[]) {
  const matrix: number[][] = []
  const values: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index]
    const { x: u, y: v } = to[index]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    values.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    values.push(v)
  }
  return solve(matrix, values)
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function nativeSize(corners: Point[]) {
  const width = Math.max(1, Math.round((distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2))
  const height = Math.max(1, Math.round((distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2))
  return { width, height }
}

export function pagePixelSize(corners: Point[], kind: "receipt" | "document") {
  const width = (distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2
  const height = (distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2
  if (kind === "document") {
    const long = Math.max(width, height, 1)
    const scale = 2200 / long
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    }
  }
  const target = width < 1800 ? 1800 : Math.max(1400, Math.min(1800, width))
  const scale = target / Math.max(width, 1)
  return {
    width: Math.max(1400, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function sample(image: ImageData, x: number, y: number) {
  const { width, height, data } = image
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const dx = x - x0
  const dy = y - y0
  const pixel = (px: number, py: number) => {
    const index = (Math.max(0, Math.min(height - 1, py)) * width + Math.max(0, Math.min(width - 1, px))) * 4
    return [data[index], data[index + 1], data[index + 2], data[index + 3]]
  }
  const a = pixel(x0, y0)
  const b = pixel(x1, y0)
  const c = pixel(x0, y1)
  const d = pixel(x1, y1)
  return [0, 1, 2, 3].map((channel) => {
    const top = a[channel] * (1 - dx) + b[channel] * dx
    const bottom = c[channel] * (1 - dx) + d[channel] * dx
    return top * (1 - dy) + bottom * dy
  })
}

export function warp(image: ImageData, corners: Point[], width: number, height: number) {
  const dest = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ]
  const map = homography(dest, corners)
  const output = new ImageData(width, height)
  if (!map) {
    return output
  }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = map
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const weight = h6 * x + h7 * y + 1
      const sx = (h0 * x + h1 * y + h2) / weight
      const sy = (h3 * x + h4 * y + h5) / weight
      const [r, g, b, a] = sample(image, sx, sy)
      const index = (y * width + x) * 4
      output.data[index] = r
      output.data[index + 1] = g
      output.data[index + 2] = b
      output.data[index + 3] = a
    }
  }
  return output
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number) {
  const output = new Float32Array(source.length)
  const window = radius * 2 + 1
  for (let y = 0; y < height; y += 1) {
    let sum = 0
    for (let x = -radius; x <= radius; x += 1) sum += source[y * width + Math.max(0, Math.min(width - 1, x))]
    for (let x = 0; x < width; x += 1) {
      output[y * width + x] = sum / window
      const remove = x - radius
      const add = x + radius + 1
      sum -= source[y * width + Math.max(0, remove)]
      sum += source[y * width + Math.min(width - 1, add)]
    }
  }
  const final = new Float32Array(source.length)
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -radius; y <= radius; y += 1) sum += output[Math.max(0, Math.min(height - 1, y)) * width + x]
    for (let y = 0; y < height; y += 1) {
      final[y * width + x] = sum / window
      const remove = y - radius
      const add = y + radius + 1
      sum -= output[Math.max(0, remove) * width + x]
      sum += output[Math.min(height - 1, add) * width + x]
    }
  }
  return final
}

function grayOf(image: ImageData) {
  const gray = new Float32Array(image.width * image.height)
  for (let index = 0; index < gray.length; index += 1) gray[index] = luminance(image.data, index * 4)
  return gray
}

export function enhance(image: ImageData, filter: ScanFilter) {
  if (filter === "original") return image
  const { width, height } = image
  const gray = grayOf(image)
  const output = new ImageData(new Uint8ClampedArray(image.data), width, height)
  if (filter === "clean") {
    const radius = Math.max(8, Math.round(Math.min(width, height) / 24))
    const background = boxBlur(gray, width, height, radius)
    const soft = boxBlur(gray, width, height, 1)
    for (let index = 0; index < gray.length; index += 1) {
      const lift = 255 / Math.max(background[index], 16)
      const base = index * 4
      for (let channel = 0; channel < 3; channel += 1) {
        let value = Math.min(255, image.data[base + channel] * lift)
        value = (value - 128) * 1.12 + 128
        const sharp = value + (value - soft[index]) * 0.45
        output.data[base + channel] = Math.max(0, Math.min(255, sharp))
      }
    }
    return output
  }
  if (filter === "gray") {
    for (let index = 0; index < gray.length; index += 1) {
      const value = Math.max(0, Math.min(255, (gray[index] - 128) * 1.25 + 128))
      const base = index * 4
      output.data[base] = value
      output.data[base + 1] = value
      output.data[base + 2] = value
    }
    return output
  }
  const radius = 15
  const local = boxBlur(gray, width, height, radius)
  for (let index = 0; index < gray.length; index += 1) {
    const value = gray[index] < local[index] - 10 ? 0 : 255
    const base = index * 4
    output.data[base] = value
    output.data[base + 1] = value
    output.data[base + 2] = value
  }
  return output
}

export function rotate(image: ImageData, turns: number) {
  const quarter = ((turns % 4) + 4) % 4
  if (quarter === 0) return image
  const width = quarter % 2 === 0 ? image.width : image.height
  const height = quarter % 2 === 0 ? image.height : image.width
  const output = new ImageData(width, height)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let nx = x
      let ny = y
      if (quarter === 1) {
        nx = image.height - 1 - y
        ny = x
      } else if (quarter === 2) {
        nx = image.width - 1 - x
        ny = image.height - 1 - y
      } else {
        nx = y
        ny = image.width - 1 - x
      }
      const from = (y * image.width + x) * 4
      const to = (ny * width + nx) * 4
      output.data.set(image.data.subarray(from, from + 4), to)
    }
  }
  return output
}

export function checksFor(image: ImageData, sourceWidth: number): PageChecks {
  const { width, height, data } = image
  const step = Math.max(1, Math.floor(Math.min(width, height) / 180))
  let mean = 0
  let count = 0
  let white = 0
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const value = luminance(data, (y * width + x) * 4)
      mean += value
      count += 1
      if (value > 248) white += 1
    }
  }
  mean /= Math.max(count, 1)
  let variance = 0
  let lapCount = 0
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const center = luminance(data, (y * width + x) * 4)
      const up = luminance(data, ((y - step) * width + x) * 4)
      const down = luminance(data, ((y + step) * width + x) * 4)
      const left = luminance(data, (y * width + (x - step)) * 4)
      const right = luminance(data, (y * width + (x + step)) * 4)
      const lap = up + down + left + right - 4 * center
      variance += lap * lap
      lapCount += 1
    }
  }
  variance /= Math.max(lapCount, 1)
  return {
    blurry: variance < 80,
    tooSmall: sourceWidth < 900,
    glare: white / Math.max(count, 1) > 0.05,
    dark: mean < 70,
    joins: false,
  }
}

export function scaleToWidth(image: ImageData, width: number) {
  if (image.width === width) return image
  const height = Math.max(1, Math.round(image.height * (width / image.width)))
  const output = new ImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = sample(image, (x * image.width) / width, (y * image.height) / height)
      const index = (y * width + x) * 4
      output.data[index] = r
      output.data[index + 1] = g
      output.data[index + 2] = b
      output.data[index + 3] = a
    }
  }
  return output
}

export function stitchVertical(images: ImageData[]) {
  if (images.length === 1) return { image: images[0], aligned: true }
  const width = Math.max(...images.map((image) => image.width))
  const normalized = images.map((image) => scaleToWidth(image, width))
  const slices: ImageData[] = []
  let aligned = true
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]
    if (index === 0) {
      slices.push(current)
      continue
    }
    const previous = slices[slices.length - 1]
    const band = Math.min(80, Math.floor(previous.height / 5), Math.floor(current.height / 5))
    let bestOffset = 0
    let best = Infinity
    const none = bandDifference(previous, current, 0, band)
    for (let offset = 8; offset <= band; offset += 4) {
      const score = bandDifference(previous, current, offset, band)
      if (score < best) {
        best = score
        bestOffset = offset
      }
    }
    if (best > none * 0.82) {
      aligned = false
      bestOffset = 0
    }
    slices.push(cropTop(current, bestOffset))
  }
  const height = slices.reduce((sum, image) => sum + image.height, 0)
  const output = new ImageData(width, height)
  let y = 0
  for (const slice of slices) {
    output.data.set(slice.data, y * width * 4)
    y += slice.height
  }
  return { image: output, aligned }
}

function cropTop(image: ImageData, rows: number) {
  if (rows <= 0) return image
  const height = image.height - rows
  const output = new ImageData(image.width, height)
  output.data.set(image.data.subarray(rows * image.width * 4))
  return output
}

function bandDifference(previous: ImageData, next: ImageData, offset: number, band: number) {
  let sum = 0
  let count = 0
  const y0 = previous.height - band
  for (let y = 0; y < band - offset; y += 2) {
    for (let x = 0; x < previous.width; x += 4) {
      const a = luminance(previous.data, ((y0 + y + offset) * previous.width + x) * 4)
      const b = luminance(next.data, (y * next.width + x) * 4)
      sum += Math.abs(a - b)
      count += 1
    }
  }
  return sum / Math.max(count, 1)
}

export function emptyChecks(): PageChecks {
  return { blurry: false, tooSmall: false, glare: false, dark: false, joins: false }
}
