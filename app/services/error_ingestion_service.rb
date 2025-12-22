class ErrorIngestionService
  Result = Struct.new(:success?, :notice, :problem, :error, keyword_init: true)

  def self.call(...)
    new(...).call
  end

  def initialize(app:, error_params:, context_params: {}, request_params: {}, user_params: {})
    @app = app
    @error_params = error_params
    @context_params = context_params
    @request_params = request_params
    @user_params = user_params
  end

  def call
    validate_params!

    ActiveRecord::Base.transaction do
      @backtrace = find_or_create_backtrace
      @problem = find_or_create_problem
      @notice = create_notice

      Result.new(success?: true, notice: @notice, problem: @problem)
    end
  rescue ValidationError => e
    Result.new(success?: false, error: e.message)
  end

  private

  attr_reader :app, :error_params, :context_params, :request_params, :user_params

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
      occurred_at: Time.current
    )
  end
end
