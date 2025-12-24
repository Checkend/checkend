class NewProblemNotifier < Noticed::Event
  deliver_by :email do |config|
    config.mailer = 'ProblemsMailer'
    config.method = :new_problem
    config.if = -> { params[:problem].app.notify_on_new_problem? }
  end

  deliver_by :slack do |config|
    config.url = -> { params[:problem].app.slack_webhook_url }
    config.json = -> { NewProblemNotifier.build_slack_payload(params) }
    config.if = -> { params[:problem].app.slack_webhook_url.present? }
    # raise_if_not_ok defaults to true, which means exceptions are raised
    # This is fine - errors should be visible and handled by the application
  end

  deliver_by :discord, class: 'Noticed::DeliveryMethods::DiscordDelivery' do |config|
    config.url = -> { params[:problem].app.discord_webhook_url }
    config.json = -> { NewProblemNotifier.build_discord_payload(params) }
    config.if = -> { params[:problem].app.discord_webhook_url.present? }
  end

  deliver_by :webhook, class: 'Noticed::DeliveryMethods::WebhookDelivery' do |config|
    config.url = -> { params[:problem].app.webhook_url }
    config.json = -> { NewProblemNotifier.build_webhook_payload(params) }
    config.if = -> { params[:problem].app.webhook_url.present? }
  end

  deliver_by :github, class: 'Noticed::DeliveryMethods::GitHubDelivery' do |config|
    config.url = -> { NewProblemNotifier.github_issues_url(params) }
    config.json = -> { NewProblemNotifier.build_github_issue_payload(params) }
    config.token = -> { params[:problem].app.github_token }
    config.if = -> { params[:problem].app.github_enabled? && params[:problem].app.github_repository.present? && params[:problem].app.github_token.present? }
  end

  def self.build_slack_payload(params, is_new: true)
    problem = params[:problem]
    notice = params[:notice]
    app = problem.app

    error_msg = problem.error_message.to_s
    truncated_msg = error_msg.length > 200 ? "#{error_msg[0...200]}..." : error_msg

    backtrace_blocks = if notice&.backtrace&.lines&.any?
      lines = notice.backtrace.lines.first(10)
      backtrace_text = lines.map { |line| "`#{line['file']}:#{line['line']}` in `#{line['method']}`" }.join("\n")
      [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: "*Backtrace (first 10 lines):*\n```\n#{backtrace_text}\n```"
          }
        }
      ]
    else
      []
    end

    host = Rails.application.config.action_mailer.default_url_options&.dig(:host) || 'localhost'
    problem_url = Rails.application.routes.url_helpers.app_problem_url(app, problem, host: host)

    first_seen = problem.first_noticed_at ? time_ago_in_words(problem.first_noticed_at) : 'Never'
    last_seen = problem.last_noticed_at ? time_ago_in_words(problem.last_noticed_at) : 'Never'

    {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: "#{is_new ? '🚨 New Error' : '⚠️ Error Reoccurred'}: #{problem.error_class}"
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: "*App:*\n#{app.name}"
            },
            {
              type: 'mrkdwn',
              text: "*Environment:*\n#{app.environment || 'Not set'}"
            },
            {
              type: 'mrkdwn',
              text: "*Error Class:*\n`#{problem.error_class}`"
            },
            {
              type: 'mrkdwn',
              text: "*Notices:*\n#{problem.notices_count}"
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: "*Message:*\n#{truncated_msg}"
          }
        }
      ] + backtrace_blocks + [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: "First seen: #{first_seen} ago | Last seen: #{last_seen} ago"
            }
          ]
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'View in Checkend'
              },
              url: problem_url,
              style: is_new ? 'danger' : 'primary'
            }
          ]
        }
      ]
    }
  end

  def self.build_discord_payload(params, is_new: true)
    problem = params[:problem]
    app = problem.app

    error_msg = problem.error_message.to_s
    truncated_msg = error_msg.length > 2000 ? "#{error_msg[0...2000]}..." : error_msg

    host = Rails.application.config.action_mailer.default_url_options&.dig(:host) || 'localhost'
    problem_url = Rails.application.routes.url_helpers.app_problem_url(app, problem, host: host)

    first_seen = problem.first_noticed_at ? time_ago_in_words(problem.first_noticed_at) : 'Never'
    last_seen = problem.last_noticed_at ? time_ago_in_words(problem.last_noticed_at) : 'Never'

    # Discord Rich Embed format
    {
      embeds: [
        {
          title: "#{is_new ? '🚨 New Error' : '⚠️ Error Reoccurred'}: #{problem.error_class}",
          description: truncated_msg,
          color: is_new ? 15158332 : 15844367, # Red for new, gold for reoccurred
          fields: [
            {
              name: 'App',
              value: app.name,
              inline: true
            },
            {
              name: 'Environment',
              value: app.environment || 'Not set',
              inline: true
            },
            {
              name: 'Error Class',
              value: "`#{problem.error_class}`",
              inline: true
            },
            {
              name: 'Notices',
              value: problem.notices_count.to_s,
              inline: true
            },
            {
              name: 'First Seen',
              value: first_seen,
              inline: true
            },
            {
              name: 'Last Seen',
              value: last_seen,
              inline: true
            }
          ],
          url: problem_url,
          timestamp: problem.last_noticed_at&.iso8601,
          footer: {
            text: 'Checkend Error Monitoring'
          }
        }
      ]
    }
  end

  def self.build_webhook_payload(params, is_new: true)
    problem = params[:problem]
    notice = params[:notice]
    app = problem.app

    host = Rails.application.config.action_mailer.default_url_options&.dig(:host) || 'localhost'
    problem_url = Rails.application.routes.url_helpers.app_problem_url(app, problem, host: host)

    # Generic webhook payload - simple JSON structure
    {
      event: is_new ? 'new_problem' : 'problem_reoccurred',
      problem: {
        id: problem.id,
        error_class: problem.error_class,
        error_message: problem.error_message,
        notices_count: problem.notices_count,
        first_noticed_at: problem.first_noticed_at&.iso8601,
        last_noticed_at: problem.last_noticed_at&.iso8601,
        status: problem.status,
        url: problem_url
      },
      app: {
        id: app.id,
        name: app.name,
        environment: app.environment,
        slug: app.slug
      },
      notice: notice ? {
        id: notice.id,
        occurred_at: notice.occurred_at&.iso8601,
        context: notice.context,
        request: notice.request,
        user_info: notice.user_info
      } : nil,
      timestamp: Time.current.iso8601
    }
  end

  def self.github_issues_url(params)
    problem = params[:problem]
    app = problem.app
    owner, repo = app.github_repository.split('/')
    "https://api.github.com/repos/#{owner}/#{repo}/issues"
  end

  def self.build_github_issue_payload(params, is_new: true)
    problem = params[:problem]
    notice = params[:notice]
    app = problem.app

    host = Rails.application.config.action_mailer.default_url_options&.dig(:host) || 'localhost'
    problem_url = Rails.application.routes.url_helpers.app_problem_url(app, problem, host: host)

    error_msg = problem.error_message.to_s
    truncated_msg = error_msg.length > 500 ? "#{error_msg[0...500]}..." : error_msg

    backtrace_section = if notice&.backtrace&.lines&.any?
      lines = notice.backtrace.lines.first(20)
      backtrace_text = lines.map { |line| "#{line['file']}:#{line['line']} in `#{line['method']}`" }.join("\n")
      "\n\n## Backtrace\n\n```\n#{backtrace_text}\n```"
    else
      ''
    end

    body = <<~MARKDOWN
      ## Error Details

      **Error Class:** `#{problem.error_class}`
      **Error Message:** #{truncated_msg}
      **Environment:** #{app.environment || 'Not set'}
      **Notices Count:** #{problem.notices_count}
      **First Seen:** #{problem.first_noticed_at ? problem.first_noticed_at.strftime('%Y-%m-%d %H:%M:%S UTC') : 'Never'}
      **Last Seen:** #{problem.last_noticed_at ? problem.last_noticed_at.strftime('%Y-%m-%d %H:%M:%S UTC') : 'Never'}
      #{backtrace_section}

      ## View in Checkend

      [View Problem](#{problem_url})
    MARKDOWN

    {
      title: "[#{app.name}] #{problem.error_class}: #{truncated_msg.split("\n").first}",
      body: body,
      labels: is_new ? [ 'bug', 'error-report' ] : [ 'bug', 'error-report', 'reoccurred' ]
    }
  end

  def self.time_ago_in_words(time)
    seconds = Time.current - time
    case seconds
    when 0..59
      "#{seconds.to_i} seconds"
    when 60..3599
      "#{(seconds / 60).to_i} minutes"
    when 3600..86399
      "#{(seconds / 3600).to_i} hours"
    when 86400..2591999
      "#{(seconds / 86400).to_i} days"
    else
      "#{(seconds / 2592000).to_i} months"
    end
  end

  notification_methods do
    def message
      problem = params[:problem]
      "New error in #{problem.app.name}: #{problem.error_class}"
    end

    def url
      problem = params[:problem]
      Rails.application.routes.url_helpers.app_problem_path(problem.app, problem)
    end
  end
end
