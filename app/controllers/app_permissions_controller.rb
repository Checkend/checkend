class AppPermissionsController < ApplicationController
  before_action :set_app
  before_action :require_app_manage_permission!

  def new
    @users = User.where.not(id: Current.user.id).order(:email_address)
    @permissions = Permission.where(resource: 'apps').order(:action)
    render layout: false
  end

  def create
    user = User.find(params[:user_id])
    permission_ids = params[:permission_ids] || []
    expires_at = parse_expiration(params[:expires_at])

    ActiveRecord::Base.transaction do
      permission_ids.each do |permission_id|
        permission = Permission.find(permission_id)

        RecordPermission.find_or_create_by!(
          user: user,
          permission: permission,
          record: @app
        ) do |rp|
          rp.grant_type = 'grant'
          rp.granted_by = Current.user
          rp.expires_at = expires_at
        end
      end
    end

    redirect_to @app, notice: "Access granted to #{user.email_address}."
  rescue ActiveRecord::RecordNotFound
    redirect_to @app, alert: 'User not found.'
  rescue ActiveRecord::RecordInvalid => e
    redirect_to @app, alert: "Failed to grant access: #{e.message}"
  end

  def destroy
    user = User.find(params[:id])

    RecordPermission.where(user: user, record: @app).destroy_all

    redirect_to @app, notice: "Access revoked for #{user.email_address}."
  rescue ActiveRecord::RecordNotFound
    redirect_to @app, alert: 'User not found.'
  end

  private

  def set_app
    @app = App.find_by!(slug: params[:app_id])
  end

  def require_app_manage_permission!
    return if can?('apps:manage', record: @app)

    handle_authorization_error('apps:manage')
  end

  def parse_expiration(value)
    return nil if value.blank? || value == 'never'

    case value
    when '1_day'
      1.day.from_now
    when '1_week'
      1.week.from_now
    when '1_month'
      1.month.from_now
    when '3_months'
      3.months.from_now
    else
      Date.parse(value).end_of_day
    end
  rescue ArgumentError
    nil
  end
end
