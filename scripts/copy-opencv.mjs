import { copyFileSync, mkdirSync } from "node:fs"

mkdirSync("public", { recursive: true })
copyFileSync("node_modules/@techstark/opencv-js/dist/opencv.js", "public/opencv.js")
