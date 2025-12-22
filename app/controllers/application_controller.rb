class ApplicationController < ActionController::Base
  include Authentication
  include Pagy::Backend
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes

  before_action :load_sidebar_apps

  private

  def load_sidebar_apps
    @sidebar_apps = Current.user&.apps&.includes(:problems)&.order(:name)&.limit(10)
  end
end
