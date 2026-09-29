interface Twiddles {
  cos: Float64Array
  sin: Float64Array
}

/** In-place radix-2 FFT of n complex values. */
function fft1(re: Float64Array, im: Float64Array, n: number, isInverse: boolean, tw: Twiddles) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = tw.cos[k * step]
        const sn = isInverse ? -tw.sin[k * step] : tw.sin[k * step]
        const a = i + k
        const b = a + half
        const xr = re[b] * c - im[b] * sn
        const xi = re[b] * sn + im[b] * c
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

const twiddles = new Map<number, Twiddles>()

function twiddlesFor(n: number): Twiddles {
  let tw = twiddles.get(n)
  if (!tw) {
    const cos = new Float64Array(n / 2)
    const sin = new Float64Array(n / 2)
    for (let k = 0; k < n / 2; k++) {
      cos[k] = Math.cos(2 * Math.PI * k / n)
      sin[k] = -Math.sin(2 * Math.PI * k / n)
    }
    tw = {
      cos,
      sin,
    }
    twiddles.set(n, tw)
  }
  return tw
}

/** In-place FFT of n×n complex data: rows, then columns. The inverse is not scaled by 1/n². */
export function fft2(re: Float64Array, im: Float64Array, n: number, isInverse: boolean) {
  const tw = twiddlesFor(n)
  const r = new Float64Array(n)
  const i = new Float64Array(n)
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n))
    i.set(im.subarray(y * n, y * n + n))
    fft1(r, i, n, isInverse, tw)
    re.set(r, y * n)
    im.set(i, y * n)
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x]
      i[y] = im[y * n + x]
    }
    fft1(r, i, n, isInverse, tw)
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y]
      im[y * n + x] = i[y]
    }
  }
}
