class NewProblemNotifier < Noticed::Event
  deliver_by :email do |config|
    config.mailer = 'ProblemsMailer'
    config.method = :new_problem
    config.if = -> { params[:problem].app.notify_on_new_problem? }
  end

  deliver_by :slack do |config|
    config.url = -> { params[:problem].app.slack_webhook_url }
    config.json = -> { build_slack_payload(params) }
    config.if = -> { params[:problem].app.slack_webhook_url.present? }
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
