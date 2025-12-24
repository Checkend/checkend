class ApiKeysController < ApplicationController
  before_action :require_site_admin!
  before_action :set_api_key, only: [:show, :destroy, :revoke]

  def index
    @api_keys = ApiKey.all.order(created_at: :desc)
  end

  def show
  end

  def new
    @api_key = ApiKey.new
    @available_permissions = [
      ['Apps', 'apps:read', 'apps:write'],
      ['Problems', 'problems:read', 'problems:write'],
      ['Notices', 'notices:read'],
      ['Tags', 'tags:read', 'tags:write'],
      ['Teams', 'teams:read', 'teams:write'],
      ['Users', 'users:read', 'users:write']
    ]
  end

  def create
    @api_key = ApiKey.new(api_key_params)

    if @api_key.save
      redirect_to api_key_path(@api_key), notice: 'API key created successfully. Save this key now - you won\'t be able to see it again!'
    else
      @available_permissions = [
        ['Apps', 'apps:read', 'apps:write'],
        ['Problems', 'problems:read', 'problems:write'],
        ['Notices', 'notices:read'],
        ['Tags', 'tags:read', 'tags:write'],
        ['Teams', 'teams:read', 'teams:write'],
        ['Users', 'users:read', 'users:write']
      ]
      render :new, status: :unprocessable_entity
    end
  end

  def destroy
    @api_key.destroy
    redirect_to api_keys_path, notice: 'API key was successfully deleted.'
  end

  def revoke
    @api_key.revoke!
    redirect_to api_key_path(@api_key), notice: 'API key was successfully revoked.'
  end

  private

  def set_api_key
    @api_key = ApiKey.find(params[:id])
  end

  def api_key_params
    params.require(:api_key).permit(:name, permissions: [])
  end
end

