# frozen_string_literal: true

module ActionView
  module Helpers
    class FormBuilder
      def has_error_on(method)
        return false unless @object.respond_to?(:errors)

        @object.errors.include?(method.to_sym)
      end

      def errors_on(method)
        return unless @object.respond_to?(:errors)
        return unless @object.errors.include?(method.to_sym)

        output = <<-OUTPUT
      <p class="mt-1 text-sm text-pink-600 dark:text-pink-400">
        #{@object.errors[method].first.capitalize}
      </p>
        OUTPUT
        output.html_safe
      end
    end
  end
end
