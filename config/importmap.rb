# Pin npm packages by running ./bin/importmap

pin 'application'
pin '@hotwired/turbo-rails', to: 'turbo.min.js'
pin '@hotwired/stimulus', to: 'stimulus.min.js'
pin '@hotwired/stimulus-loading', to: 'stimulus-loading.js'
pin_all_from 'app/javascript/controllers', under: 'controllers'

# Alpine.js for simple interactions
pin 'alpinejs', to: 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/module.esm.js'
pin 'alpine-turbo-drive-adapter', to: 'https://cdn.jsdelivr.net/npm/alpine-turbo-drive-adapter@2.1.0/dist/alpine-turbo-drive-adapter.esm.js'
