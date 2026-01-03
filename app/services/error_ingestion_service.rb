class ErrorIngestionService
  Result = Struct.new(:success?, :notice, :problem, :error, keyword_init: true)

  def self.call(...)
    new(...).call
  end

  def initialize(app:, error_params:, context_params: {}, request_params: {}, user_params: {}, notifier_params: {})
    @app = app
    @error_params = error_params
    @context_params = context_params
    @request_params = request_params
    @user_params = user_params
    @notifier_params = notifier_params
  end

  def call
    validate_params!

    ActiveRecord::Base.transaction do
      @backtrace = find_or_create_backtrace
      @problem = find_or_create_problem
      @notice = create_notice
    end

    notify_if_needed

    Result.new(success?: true, notice: @notice, problem: @problem)
  rescue ValidationError => e
    Result.new(success?: false, error: e.message)
  end

  private

  attr_reader :app, :error_params, :context_params, :request_params, :user_params, :notifier_params

  class ValidationError < StandardError; end

  def validate_params!
    raise ValidationError, 'error.class is required' if error_class.blank?
  end

  def error_class
    error_params[:class]
  end

  def error_message
    error_params[:message]
  end

  def raw_backtrace
    error_params[:backtrace] || []
  end

  def custom_fingerprint
    error_params[:fingerprint]
  end

  def find_or_create_backtrace
    return nil if raw_backtrace.empty?

    parsed_lines = BacktraceParser.parse(raw_backtrace)
    Backtrace.find_or_create_by_lines(parsed_lines)
  end

  def find_or_create_problem
    fingerprint = custom_fingerprint.presence || generate_fingerprint

    problem = app.problems.find_or_initialize_by(fingerprint: fingerprint)
    @problem_was_resolved = problem.persisted? && problem.resolved?
    @problem_is_new = problem.new_record?

    # Auto-unresolve if a resolved problem gets a new notice
    if @problem_was_resolved
      problem.status = 'unresolved'
      problem.resolved_at = nil
    end

    problem.error_class = error_class
    problem.error_message = error_message
    problem.save!
    problem
  end

  def generate_fingerprint
    first_line = raw_backtrace.first || ''
    Problem.generate_fingerprint(error_class, error_message, first_line)
  end

  def create_notice
    Notice.create!(
      problem: @problem,
      backtrace: @backtrace,
      error_class: error_class,
      error_message: error_message,
      context: context_params.to_h,
      request: request_params.to_h,
      user_info: user_params.to_h,
      notifier: notifier_params.presence,
      occurred_at: parse_occurred_at
    )
  end

  def parse_occurred_at
    return Time.current if error_params[:occurred_at].blank?

    Time.parse(error_params[:occurred_at])
  rescue ArgumentError
    Time.current
  end

  def notify_if_needed
    event_type = @problem_is_new ? :new_problem : :reoccurrence
    recipients = @problem.app.notification_recipients(event_type)

    recipients.each do |recipient|
      if @problem_is_new
        NewProblemNotifier.with(problem: @problem, notice: @notice).deliver_later(recipient)
      elsif @problem_was_resolved
        ProblemReoccurredNotifier.with(problem: @problem, notice: @notice).deliver_later(recipient)
      end
    end
  end
end
