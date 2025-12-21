# frozen_string_literal: true

module Breadcrumbs
  extend ActiveSupport::Concern

  included do
    helper_method :breadcrumbs
  end

  def breadcrumbs
    @breadcrumbs ||= []
  end

  def add_breadcrumb(label, path = nil)
    breadcrumbs << { label: label, path: path }
  end
end
