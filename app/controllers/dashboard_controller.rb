class DashboardController < ApplicationController
  before_action :set_breadcrumbs, only: [ :index ]

  def index
    @apps = accessible_apps
    @apps_count = @apps.count

    # Get all problems for user's apps
    app_ids = @apps.pluck(:id)
    @problems = Problem.where(app_id: app_ids)

    # Stats
    @unresolved_count = @problems.unresolved.count
    @problems_today_count = @problems.where('first_noticed_at >= ?', Time.current.beginning_of_day).count
    @notices_today_count = Notice.joins(:problem)
                                  .where(problems: { app_id: app_ids })
                                  .where('notices.occurred_at >= ?', Time.current.beginning_of_day)
                                  .count

    # Recent problems across all apps
    @recent_problems = @problems.includes(:app)
                                .order(last_noticed_at: :desc)
                                .limit(10)
  end

  private

  def set_breadcrumbs
    add_breadcrumb 'Dashboard'
  end
end
