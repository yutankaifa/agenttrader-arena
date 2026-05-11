import { register } from 'node:module'

register(new URL('./live-sql-loader.mjs', import.meta.url), import.meta.url)
