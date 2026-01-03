// Configure your import map in config/importmap.rb. Read more: https://github.com/rails/importmap-rails
import "@hotwired/turbo-rails"
import "controllers"
import "chartkick"
import "Chart.bundle"

// Alpine.js for simple interactions
import Alpine from "alpinejs"
window.Alpine = Alpine
import "alpine-turbo-drive-adapter"
Alpine.start()
