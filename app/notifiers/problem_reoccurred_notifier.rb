class ProblemReoccurredNotifier < Noticed::Event
  deliver_by :email do |config|
    config.mailer = 'ProblemsMailer'
    config.method = :problem_reoccurred
    config.if = -> { params[:problem].app.notify_on_reoccurrence? }
  end

  deliver_by :slack do |config|
    config.url = -> { params[:problem].app.slack_webhook_url }
    config.json = -> { NewProblemNotifier.build_slack_payload(params, is_new: false) }
    config.if = -> { params[:problem].app.slack_webhook_url.present? }
  end

  def slack_payload
    problem = params[:problem]
    notice = params[:notice]
    app = problem.app

    {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: "⚠️ Error Reoccurred: #{problem.error_class}"
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
            text: "*Message:*\n#{truncate(problem.error_message, 200)}"
          }
        }
      ] + backtrace_blocks(notice) + [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: "First seen: #{time_ago(problem.first_noticed_at)} | Last seen: #{time_ago(problem.last_noticed_at)}"
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
              url: problem_url(problem, app),
              style: 'primary'
            }
          ]
        }
      ]
    }
  end

  private

  def backtrace_blocks(notice)
    return [] unless notice&.backtrace&.lines&.any?

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
  end

  def problem_url(problem, app)
    Rails.application.routes.url_helpers.app_problem_url(app, problem, host: default_url_host)
  end

  def default_url_host
    Rails.application.config.action_mailer.default_url_options&.dig(:host) || 'localhost'
  end

  def truncate(text, length)
    return '' if text.blank?
    text.length > length ? "#{text[0...length]}..." : text
  end

  def time_ago(time)
    return 'Never' unless time
    "#{time_ago_in_words(time)} ago"
  end

  def time_ago_in_words(time)
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
      "Error reoccurred in #{problem.app.name}: #{problem.error_class}"
    end

    def url
      problem = params[:problem]
      Rails.application.routes.url_helpers.app_problem_path(problem.app, problem)
    end
  end
end
