class Settings::ProfilesController < ApplicationController
  before_action :set_breadcrumbs

  def show
  end

  private

  def set_breadcrumbs
    add_breadcrumb 'Settings', settings_profile_path
  end
end
